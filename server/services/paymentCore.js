// 会計処理のコア。payments.js（座席テーブルの会計）と orders.js（即会計 record-only）で
// 同一の計算・確定ロジックを共有するために抽出したもの。挙動は従来の payments.js と同一。
// - parsePayParams(body): リクエストボディを検証・正規化（BEGIN 前に呼ぶ）。失敗時は {status, error} を throw。
// - settleOrderTx(client, orderId, params): 与えられた client(=トランザクション)内で 1 注文を会計確定する。
//   BEGIN/COMMIT/ROLLBACK・ブロードキャストは行わない（呼び出し側が管理）。失敗時は {status, error} を throw。
//   戻り値: { result, tableFreed, tableId }（result は API 返却用オブジェクト）。
const { checkLateNight } = require('../utils/time');

const VALID_METHODS = ['cash', 'card', 'emoney'];
const MAX_GIFT_CERT = 1_000_000; // 金券の絶対上限(桁溢れ/過大な負cash防止)

// リクエストボディを検証して正規化パラメータを返す。不正時は {status, error} を throw。
function parsePayParams(body = {}) {
  const {
    payment_method   = 'cash',
    payments         = null,
    discount_amount  = 0,
    memo             = null,
    gift_cert_amount = 0,
    gift_cert_no_change = false,
    idempotency_key  = null,
  } = body;

  const splitProvided = Array.isArray(payments) && payments.length > 0;

  if (!splitProvided && !VALID_METHODS.includes(payment_method)) {
    throw { status: 400, error: 'Invalid payment_method. Use cash, card, or emoney.' };
  }
  if (parseFloat(discount_amount) < 0) throw { status: 400, error: 'discount_amount must be >= 0' };
  if (parseFloat(gift_cert_amount) < 0) throw { status: 400, error: 'gift_cert_amount must be >= 0' };
  if (parseFloat(gift_cert_amount) > MAX_GIFT_CERT) throw { status: 400, error: `gift_cert_amount must be <= ${MAX_GIFT_CERT}` };

  if (splitProvided) {
    const seen = new Set();
    for (const p of payments) {
      if (!p || !VALID_METHODS.includes(p.method)) {
        throw { status: 400, error: `Invalid split method. Use ${VALID_METHODS.join(', ')}.` };
      }
      if (seen.has(p.method)) throw { status: 400, error: 'Duplicate split payment method' };
      seen.add(p.method);
      if (!(parseFloat(p.amount) >= 0)) throw { status: 400, error: 'Split amount must be a number >= 0' };
    }
    if (parseFloat(gift_cert_amount) > 0) throw { status: 400, error: '分割会計と金券は併用できません' };
  }

  return { payment_method, payments, splitProvided, discount_amount, memo, gift_cert_amount, gift_cert_no_change, idempotency_key };
}

// 1 注文を会計確定する（トランザクション内。BEGIN/COMMIT は呼び出し側）。
async function settleOrderTx(client, orderId, params) {
  const {
    payment_method, payments, splitProvided,
    discount_amount, memo, gift_cert_amount, gift_cert_no_change, idempotency_key,
  } = params;

  // FOR UPDATE で行ロックを取得（status 非依存で取得し、冪等リトライ/二重会計を判定）
  const { rows: orderRows } = await client.query(
    `SELECT id, table_id, status, total_amount::float,
            charge_amount::float, charge_per_person::float,
            guest_count, receipt_type, idempotency_key,
            discount_amount::float, tax_rate::float, tax_amount::float,
            late_night_rate::float, late_night_amount::float,
            cash_amount::float, card_amount::float, emoney_amount::float,
            gift_cert_amount::float, payment_method
     FROM orders WHERE id = $1 FOR UPDATE`,
    [orderId]
  );
  const order = orderRows[0];
  if (!order) throw { status: 404, error: 'Open order not found' };

  // 冪等: 同一キーで既に会計済みなら、元の会計結果を再構成して返す（タイムアウト再送の安全化）
  if (order.status === 'paid') {
    if (idempotency_key && order.idempotency_key === idempotency_key) {
      return {
        tableFreed: false, tableId: order.table_id,
        result: {
          orderId: order.id, tableId: order.table_id,
          subtotal: order.total_amount + order.discount_amount,
          discount: order.discount_amount,
          late_night_rate: order.late_night_rate, late_night_amount: order.late_night_amount,
          tax_rate: order.tax_rate, tax_amount: order.tax_amount,
          total: order.total_amount,
          paymentMethod: order.payment_method,
          payments: { cash: order.cash_amount, card: order.card_amount, emoney: order.emoney_amount },
          giftCertAmount: order.gift_cert_amount,
          paidAt: null, idempotent: true,
        },
      };
    }
    throw { status: 409, error: 'この伝票は既に会計済みです' };
  }
  if (order.status !== 'open') throw { status: 404, error: 'Open order not found' };

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
  if (items.length === 0 && chargeAmount === 0) {
    throw { status: 400, error: '明細がありません。会計できません。' };
  }
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
  const late_night_amount = isLate ? Math.round(itemsSubtotal * late_night_rate) : 0;

  const standardItemsTotal = items
    .filter(i => i.tax_category !== 'reduced')
    .reduce((sum, i) => sum + i.quantity * i.unit_price, 0);
  const reducedItemsTotal = items
    .filter(i => i.tax_category === 'reduced')
    .reduce((sum, i) => sum + i.quantity * i.unit_price, 0);

  const taxable_standard_raw = standardItemsTotal + chargeAmount + late_night_amount - discount;
  const discountRemainder = Math.max(0, discount - standardItemsTotal - chargeAmount - late_night_amount);
  const taxable_standard = Math.max(0, taxable_standard_raw);
  const taxable_reduced  = Math.max(0, reducedItemsTotal - discountRemainder);

  const tax_amount = Math.round(taxable_standard * tax_rate / (1 + tax_rate))
                   + Math.round(taxable_reduced  * reduced_tax_rate / (1 + reduced_tax_rate));
  const total = taxable_standard + taxable_reduced;

  const raw_gift_cert       = Math.max(0, parseFloat(gift_cert_amount) || 0);
  const effective_gift_cert = gift_cert_no_change ? Math.min(raw_gift_cert, total) : raw_gift_cert;

  const methodAmounts = { cash: 0, card: 0, emoney: 0 };
  let representativeMethod;
  if (splitProvided) {
    const splitSum = payments.reduce((sum, p) => sum + Math.round(parseFloat(p.amount) || 0), 0);
    if (splitSum !== total) {
      throw { status: 400, error: `分割金額の合計(¥${splitSum})が会計総額(¥${total})と一致しません` };
    }
    for (const p of payments) methodAmounts[p.method] = Math.round(parseFloat(p.amount) || 0);
    const usedMethods = VALID_METHODS.filter((m) => methodAmounts[m] > 0);
    representativeMethod = usedMethods.length >= 2 ? 'split' : (usedMethods[0] ?? payment_method);
  } else {
    methodAmounts[payment_method] = total - effective_gift_cert;
    representativeMethod = payment_method;
  }

  await client.query(
    `UPDATE orders
     SET status = 'paid', closed_at = NOW(),
         total_amount = $1, payment_method = $2,
         discount_amount = $3, tax_rate = $4, tax_amount = $5,
         late_night_rate = $6, late_night_amount = $7,
         memo = $8, gift_cert_amount = $9, gift_cert_no_change = $10,
         cash_amount = $11, card_amount = $12, emoney_amount = $13,
         idempotency_key = $15
     WHERE id = $14`,
    [total, representativeMethod, discount, tax_rate, tax_amount,
     late_night_rate, late_night_amount,
     memo || null, effective_gift_cert, gift_cert_no_change,
     methodAmounts.cash, methodAmounts.card, methodAmounts.emoney,
     order.id, idempotency_key]
  );

  // レシピベースの材料在庫自動減算（ingredient_id 昇順でロック取得＝デッドロック回避）
  const deductMap = new Map();
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

  // 同テーブルの残オープンオーダーがなければ available に戻す（赤伝票との共存考慮）
  const { rows: remaining } = await client.query(
    `SELECT id FROM orders WHERE table_id = $1 AND status = 'open'`,
    [order.table_id]
  );
  const tableFreed = remaining.length === 0;
  if (tableFreed) {
    await client.query(`UPDATE tables SET status = 'available' WHERE id = $1`, [order.table_id]);
  }

  return {
    tableFreed, tableId: order.table_id,
    result: {
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
      payments: methodAmounts,
      giftCertAmount: effective_gift_cert,
      paidAt: new Date().toISOString(),
    },
  };
}

module.exports = { parsePayParams, settleOrderTx, VALID_METHODS, MAX_GIFT_CERT };
