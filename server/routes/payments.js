const express = require('express');
const router = express.Router();
const { pool, query } = require('../db/database');
const { broadcast } = require('../services/socketService');

const { checkLateNight } = require('../utils/time');

const VALID_METHODS = ['cash', 'card', 'emoney'];

// POST /api/payments/:orderId
router.post('/:orderId', async (req, res, next) => {
  const {
    payment_method   = 'cash',
    payments         = null,   // 分割会計: [{ method:'cash', amount:2000 }, ...]（任意）
    discount_amount  = 0,
    memo             = null,
    gift_cert_amount = 0,
    gift_cert_no_change = false,
  } = req.body;

  // 分割会計が指定されているか（配列で1件以上）
  const splitProvided = Array.isArray(payments) && payments.length > 0;

  // 単一方法時のみ payment_method を検証（分割時は代表値をサーバ側で決めるため無視）
  if (!splitProvided && !VALID_METHODS.includes(payment_method)) {
    return res.status(400).json({ error: 'Invalid payment_method. Use cash, card, or emoney.' });
  }
  if (parseFloat(discount_amount) < 0) {
    return res.status(400).json({ error: 'discount_amount must be >= 0' });
  }
  if (parseFloat(gift_cert_amount) < 0) {
    return res.status(400).json({ error: 'gift_cert_amount must be >= 0' });
  }

  // 分割会計の構造チェック（合計金額の一致チェックは total 算出後に実施）
  if (splitProvided) {
    const seen = new Set();
    for (const p of payments) {
      if (!p || !VALID_METHODS.includes(p.method)) {
        return res.status(400).json({ error: `Invalid split method. Use ${VALID_METHODS.join(', ')}.` });
      }
      if (seen.has(p.method)) {
        return res.status(400).json({ error: 'Duplicate split payment method' });
      }
      seen.add(p.method);
      if (!(parseFloat(p.amount) >= 0)) {
        return res.status(400).json({ error: 'Split amount must be a number >= 0' });
      }
    }
    if (parseFloat(gift_cert_amount) > 0) {
      return res.status(400).json({ error: '分割会計と金券は併用できません' });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // FOR UPDATE で行ロックを取得してから status 確認（二重会計防止）
    const { rows: orderRows } = await client.query(
      `SELECT id, table_id, status, total_amount::float,
              charge_amount::float, charge_per_person::float,
              guest_count, receipt_type
       FROM orders WHERE id = $1 AND status = 'open' FOR UPDATE`,
      [req.params.orderId]
    );
    const order = orderRows[0];
    if (!order) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Open order not found' });
    }

    const { rows: items } = await client.query(
      `SELECT oi.id, oi.order_id, oi.menu_item_id, oi.quantity,
              oi.unit_price::float, oi.item_name,
              COALESCE(m.tax_category, 'standard') AS tax_category
       FROM order_items oi JOIN menu_items m ON oi.menu_item_id = m.id
       WHERE oi.order_id = $1`,
      [order.id]
    );

    // 即会計は商品代金のみ（チャージ・深夜料金の対象外）
    const { rows: tableRows } = await client.query(
      `SELECT table_type FROM tables WHERE id = $1`, [order.table_id]
    );
    const isImmediate = tableRows[0]?.table_type === 'immediate';

    const itemsSubtotal = items.reduce((sum, i) => sum + i.quantity * i.unit_price, 0);
    const chargeAmount  = isImmediate ? 0 : (order.charge_amount || 0);
    const subtotal = itemsSubtotal + chargeAmount;
    const discount = Math.max(0, Math.min(parseFloat(discount_amount) || 0, subtotal));

    const { rows: settingRows } = await client.query('SELECT key, value FROM system_settings');
    const s = settingRows.reduce((acc, r) => { acc[r.key] = r.value; return acc; }, {});

    const tax_rate          = parseFloat(s.tax_rate          ?? '0.10');
    const reduced_tax_rate  = parseFloat(s.reduced_tax_rate  ?? '0.08');
    const late_night_rate_s = parseFloat(s.late_night_rate   ?? '0.10');
    const late_night_start  = parseInt(  s.late_night_start  ?? '22', 10);
    const late_night_end    = parseInt(  s.late_night_end    ?? '29', 10);

    const isLate            = !isImmediate && checkLateNight(late_night_start, late_night_end);
    const late_night_rate   = isLate ? late_night_rate_s : 0;
    // 深夜料金はアイテム小計のみに適用（チャージは固定料金のため除外）
    const late_night_amount = isLate ? Math.round(itemsSubtotal * late_night_rate) : 0;

    // 商品別税率で内税額を計算
    const standardItemsTotal = items
      .filter(i => i.tax_category !== 'reduced')
      .reduce((sum, i) => sum + i.quantity * i.unit_price, 0);
    const reducedItemsTotal = items
      .filter(i => i.tax_category === 'reduced')
      .reduce((sum, i) => sum + i.quantity * i.unit_price, 0);

    // チャージ・深夜料金は標準税率扱い。割引は標準税率分から先に引く。
    const taxable_standard_raw = standardItemsTotal + chargeAmount + late_night_amount - discount;
    const discountRemainder = Math.max(0, discount - standardItemsTotal - chargeAmount - late_night_amount);
    const taxable_standard = Math.max(0, taxable_standard_raw);
    const taxable_reduced  = Math.max(0, reducedItemsTotal - discountRemainder);

    const tax_amount = Math.round(taxable_standard * tax_rate / (1 + tax_rate))
                     + Math.round(taxable_reduced  * reduced_tax_rate / (1 + reduced_tax_rate));
    const total = taxable_standard + taxable_reduced;

    // 金券: 釣り無しの場合は合計を超えない
    const raw_gift_cert       = Math.max(0, parseFloat(gift_cert_amount) || 0);
    const effective_gift_cert = gift_cert_no_change
      ? Math.min(raw_gift_cert, total)
      : raw_gift_cert;

    // 支払い方法別の金額を決定（不変条件: cash+card+emoney = total_amount）
    const methodAmounts = { cash: 0, card: 0, emoney: 0 };
    let representativeMethod;
    if (splitProvided) {
      // 分割: 各金額の合計は total と一致必須（金券併用なしのため total = 方法で払う額）
      const splitSum = payments.reduce((s, p) => s + Math.round(parseFloat(p.amount) || 0), 0);
      if (splitSum !== total) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `分割金額の合計(¥${splitSum})が会計総額(¥${total})と一致しません` });
      }
      for (const p of payments) methodAmounts[p.method] = Math.round(parseFloat(p.amount) || 0);
      const usedMethods = VALID_METHODS.filter((m) => methodAmounts[m] > 0);
      // 2方法以上なら代表値は 'split'、1方法だけなら実質単一なのでその方法名
      representativeMethod = usedMethods.length >= 2 ? 'split' : (usedMethods[0] ?? payment_method);
    } else {
      // 単一: 従来どおり選んだ方法のカラム = total_amount、他は0
      methodAmounts[payment_method] = total;
      representativeMethod = payment_method;
    }

    await client.query(
      `UPDATE orders
       SET status = 'paid', closed_at = NOW(),
           total_amount = $1, payment_method = $2,
           discount_amount = $3, tax_rate = $4, tax_amount = $5,
           late_night_rate = $6, late_night_amount = $7,
           memo = $8, gift_cert_amount = $9, gift_cert_no_change = $10,
           cash_amount = $11, card_amount = $12, emoney_amount = $13
       WHERE id = $14`,
      [total, representativeMethod, discount, tax_rate, tax_amount,
       late_night_rate, late_night_amount,
       memo || null, effective_gift_cert, gift_cert_no_change,
       methodAmounts.cash, methodAmounts.card, methodAmounts.emoney,
       order.id]
    );
    // レシピベースの材料在庫自動減算
    // 全アイテムの必要材料を先に集計してから ingredient_id 昇順でロック取得する
    // （同時実行される他の会計・棚卸し調整とのデッドロックを防ぐため、ロック順序を統一する）
    const deductMap = new Map(); // ingredient_id -> 合計消費量
    for (const item of items) {
      const { rows: recipeRows } = await client.query(
        `SELECT r.ingredient_id, r.usage_quantity::float
         FROM recipes r
         JOIN ingredient_stock s ON s.ingredient_id = r.ingredient_id
         WHERE r.menu_item_id = $1`,
        [item.menu_item_id]
      );
      for (const r of recipeRows) {
        const deduct = r.usage_quantity * item.quantity;
        deductMap.set(r.ingredient_id, (deductMap.get(r.ingredient_id) ?? 0) + deduct);
      }
    }
    const sortedIngredientIds = [...deductMap.keys()].sort((a, b) => a - b);
    for (const ingredientId of sortedIngredientIds) {
      const deduct = deductMap.get(ingredientId);
      const { rows: stock } = await client.query(
        'SELECT quantity_current FROM ingredient_stock WHERE ingredient_id = $1 FOR UPDATE',
        [ingredientId]
      );
      const before = parseFloat(stock[0].quantity_current);
      const after  = Math.max(0, before - deduct);
      await client.query(
        'UPDATE ingredient_stock SET quantity_current = $1, last_updated = NOW() WHERE ingredient_id = $2',
        [after, ingredientId]
      );
      await client.query(
        `INSERT INTO ingredient_stock_logs (ingredient_id, quantity_before, quantity_after, quantity_change, reason, related_order_id)
         VALUES ($1, $2, $3, $4, 'order', $5)`,
        [ingredientId, before, after, -deduct, order.id]
      );
    }
    // 同テーブルの残オープンオーダーがなければavailableに戻す（赤伝票との共存考慮）
    const { rows: remaining } = await client.query(
      `SELECT id FROM orders WHERE table_id = $1 AND status = 'open'`,
      [order.table_id]
    );
    if (remaining.length === 0) {
      await client.query(`UPDATE tables SET status = 'available' WHERE id = $1`, [order.table_id]);
    }
    await client.query('COMMIT');

    if (remaining.length === 0) {
      broadcast('table:status_changed', { tableId: order.table_id, status: 'available' });
    }

    res.json({
      orderId: order.id,
      tableId: order.table_id,
      subtotal,
      discount,
      late_night_rate,
      late_night_amount,
      tax_rate,
      tax_amount,
      total,
      paymentMethod: representativeMethod,
      payments: methodAmounts,   // { cash, card, emoney } 方法別内訳（結果表示用）
      giftCertAmount: effective_gift_cert,
      paidAt: new Date().toISOString(),
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;
