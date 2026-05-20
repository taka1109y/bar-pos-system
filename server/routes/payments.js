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
    discount_amount  = 0,
    memo             = null,
    gift_cert_amount = 0,
    gift_cert_no_change = false,
  } = req.body;

  if (!VALID_METHODS.includes(payment_method)) {
    return res.status(400).json({ error: 'Invalid payment_method. Use cash, card, or emoney.' });
  }
  if (parseFloat(discount_amount) < 0) {
    return res.status(400).json({ error: 'discount_amount must be >= 0' });
  }
  if (parseFloat(gift_cert_amount) < 0) {
    return res.status(400).json({ error: 'gift_cert_amount must be >= 0' });
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

    const itemsSubtotal = items.reduce((sum, i) => sum + i.quantity * i.unit_price, 0);
    const chargeAmount  = order.charge_amount || 0;
    const subtotal = itemsSubtotal + chargeAmount;
    const discount = Math.max(0, Math.min(parseFloat(discount_amount) || 0, subtotal));

    const { rows: settingRows } = await client.query('SELECT key, value FROM system_settings');
    const s = settingRows.reduce((acc, r) => { acc[r.key] = r.value; return acc; }, {});

    const tax_rate          = parseFloat(s.tax_rate          ?? '0.10');
    const reduced_tax_rate  = parseFloat(s.reduced_tax_rate  ?? '0.08');
    const late_night_rate_s = parseFloat(s.late_night_rate   ?? '0.10');
    const late_night_start  = parseInt(  s.late_night_start  ?? '22', 10);
    const late_night_end    = parseInt(  s.late_night_end    ?? '29', 10);

    const isLate            = checkLateNight(late_night_start, late_night_end);
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
    await client.query(
      `UPDATE orders
       SET status = 'paid', closed_at = NOW(),
           total_amount = $1, payment_method = $2,
           discount_amount = $3, tax_rate = $4, tax_amount = $5,
           late_night_rate = $6, late_night_amount = $7,
           memo = $8, gift_cert_amount = $9, gift_cert_no_change = $10
       WHERE id = $11`,
      [total, payment_method, discount, tax_rate, tax_amount,
       late_night_rate, late_night_amount,
       memo || null, effective_gift_cert, gift_cert_no_change,
       order.id]
    );
    // レシピベースの材料在庫自動減算
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
        const { rows: stock } = await client.query(
          'SELECT quantity_current FROM ingredient_stock WHERE ingredient_id = $1',
          [r.ingredient_id]
        );
        const before = parseFloat(stock[0].quantity_current);
        const after  = Math.max(0, before - deduct);
        await client.query(
          'UPDATE ingredient_stock SET quantity_current = $1, last_updated = NOW() WHERE ingredient_id = $2',
          [after, r.ingredient_id]
        );
        await client.query(
          `INSERT INTO ingredient_stock_logs (ingredient_id, quantity_before, quantity_after, quantity_change, reason, related_order_id)
           VALUES ($1, $2, $3, $4, 'order', $5)`,
          [r.ingredient_id, before, after, -deduct, order.id]
        );
      }
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
      paymentMethod: payment_method,
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
