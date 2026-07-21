const express = require('express');
const router = express.Router();
const { pool, query } = require('../db/database');
const { broadcast } = require('../services/socketService');
const { TZ, todayJST } = require('../utils/time');
const { assertDateFormat } = require('../utils/validate');

// GET /api/receipts?date=YYYY-MM-DD[&since=ISO_TIMESTAMP]
// since 指定時はレジ開店時刻以降（営業セッション基準）で抽出し、日計レポート(/reports/daily)と一致させる。
// 未指定時は従来どおり暦日(date)基準（伝票情報ページ ReceiptsPage 用）。
router.get('/', async (req, res, next) => {
  try {
    const date = req.query.date || todayJST();
    try { assertDateFormat(date, 'date'); } catch (e) { return res.status(e.status).json({ error: e.error }); }

    const since = req.query.since || null;
    if (since && Number.isNaN(Date.parse(since))) {
      return res.status(400).json({ error: 'since must be a valid timestamp' });
    }

    // since 指定時は closed_at/opened_at >= since、未指定時は暦日一致。
    // 参照しないプレースホルダを残さないよう WHERE 句と params を分岐で切り替える。
    const whereClause = since
      ? `(o.status = 'paid' AND o.closed_at >= $1)
         OR (o.status = 'open' AND o.receipt_type = 'red' AND o.opened_at >= $1)`
      : `(o.status = 'paid' AND (o.closed_at AT TIME ZONE $2)::date = $1)
         OR (o.status = 'open' AND o.receipt_type = 'red' AND (o.opened_at AT TIME ZONE $2)::date = $1)`;
    const params = since ? [since] : [date, TZ];

    const { rows } = await query(
      `SELECT
         o.id,
         o.receipt_type,
         o.original_order_id,
         o.status,
         o.table_id,
         o.closed_at,
         o.opened_at,
         o.total_amount::float,
         o.discount_amount::float,
         o.late_night_rate::float,
         o.late_night_amount::float,
         o.tax_rate::float,
         o.tax_amount::float,
         o.payment_method,
         o.memo,
         o.gift_cert_amount::float,
         o.gift_cert_no_change,
         o.charge_per_person::float,
         o.charge_amount::float,
         o.guest_count,
         t.name AS table_name,
         COALESCE(
           json_agg(
             json_build_object(
               'item_name', oi.item_name,
               'quantity',  oi.quantity,
               'unit_price', oi.unit_price::float
             ) ORDER BY oi.id
           ) FILTER (WHERE oi.id IS NOT NULL),
           '[]'::json
         ) AS items
       FROM orders o
       JOIN tables t ON o.table_id = t.id
       LEFT JOIN order_items oi ON oi.order_id = o.id
       WHERE (
         ${whereClause}
       )
       GROUP BY o.id, o.receipt_type, o.original_order_id, o.status, o.table_id,
                o.closed_at, o.opened_at, o.total_amount, o.discount_amount,
                o.late_night_rate, o.late_night_amount, o.tax_rate, o.tax_amount,
                o.payment_method, o.memo, o.gift_cert_amount, o.gift_cert_no_change,
                o.charge_per_person, o.charge_amount, o.guest_count,
                t.name
       ORDER BY COALESCE(o.closed_at, o.opened_at) DESC`,
      params
    );

    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// POST /api/receipts/:orderId/void-and-reissue — 赤伝票発行
router.post('/:orderId/void-and-reissue', async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // FOR UPDATE で行ロックを取得してから状態確認（二重取消し防止）
    const { rows: orderRows } = await client.query(
      `SELECT id, table_id, status, receipt_type, closed_at,
              total_amount, payment_method, guest_count, discount_amount,
              tax_rate, tax_amount, late_night_rate, late_night_amount,
              memo, gift_cert_amount, gift_cert_no_change,
              charge_per_person, charge_amount
       FROM orders WHERE id = $1 FOR UPDATE`,
      [req.params.orderId]
    );
    const order = orderRows[0];
    if (!order) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Order not found' });
    }
    if (order.status !== 'paid' || !['normal', 'red'].includes(order.receipt_type)) {
      await client.query('ROLLBACK');
      return res.status(422).json({ error: '会計済み伝票のみ取消し可能です' });
    }

    // 当日の伝票のみ操作可能
    const closedDate = new Date(order.closed_at).toLocaleDateString('sv-SE', { timeZone: TZ });
    if (closedDate !== todayJST()) {
      await client.query('ROLLBACK');
      return res.status(422).json({ error: '当日の伝票のみ赤伝票を発行できます' });
    }

    // 二重取消し防止（FOR UPDATE により競合するリクエストはここで直列化される）
    const { rows: existingVoid } = await client.query(
      `SELECT id FROM orders WHERE original_order_id = $1 AND receipt_type = 'void'`,
      [order.id]
    );
    if (existingVoid.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'この伝票はすでに取消し済みです' });
    }

    // 元オーダーの order_items を取得
    const { rows: originalItems } = await client.query(
      `SELECT menu_item_id, quantity, unit_price, item_name
       FROM order_items WHERE order_id = $1`,
      [order.id]
    );

    // 1. 元オーダーを黒伝票取消しに変更
    await client.query(
      `UPDATE orders SET receipt_type = 'black_cancelled' WHERE id = $1`,
      [order.id]
    );

    // 2. 会計取消し証跡レコードを作成
    const { rows: voidRows } = await client.query(
      `INSERT INTO orders (
         table_id, status, total_amount, payment_method,
         opened_at, closed_at, guest_count, discount_amount,
         tax_rate, tax_amount, late_night_rate, late_night_amount,
         memo, gift_cert_amount, gift_cert_no_change,
         charge_per_person, charge_amount,
         receipt_type, original_order_id
       ) VALUES (
         $1, 'paid', $2, $3,
         NOW(), NOW(), $4, $5,
         $6, $7, $8, $9,
         $10, $11, $12,
         $13, $14,
         'void', $15
       ) RETURNING id`,
      [
        order.table_id, order.total_amount, order.payment_method,
        order.guest_count, order.discount_amount,
        order.tax_rate, order.tax_amount, order.late_night_rate, order.late_night_amount,
        order.memo, order.gift_cert_amount, order.gift_cert_no_change,
        order.charge_per_person, order.charge_amount,
        order.id,
      ]
    );
    const voidOrderId = voidRows[0].id;

    // 3. 赤伝票オーダーを作成
    const { rows: redRows } = await client.query(
      `INSERT INTO orders (
         table_id, status, total_amount, payment_method,
         opened_at, guest_count, discount_amount,
         tax_rate, tax_amount, late_night_rate, late_night_amount,
         memo, gift_cert_amount, gift_cert_no_change,
         charge_per_person, charge_amount,
         receipt_type, original_order_id
       ) VALUES (
         $1, 'open', $2, $3,
         NOW(), $4, $5,
         $6, $7, $8, $9,
         $10, $11, $12,
         $13, $14,
         'red', $15
       ) RETURNING id`,
      [
        order.table_id, order.total_amount, order.payment_method,
        order.guest_count, order.discount_amount,
        order.tax_rate, order.tax_amount, order.late_night_rate, order.late_night_amount,
        order.memo, order.gift_cert_amount, order.gift_cert_no_change,
        order.charge_per_person, order.charge_amount,
        order.id,
      ]
    );
    const redOrderId = redRows[0].id;

    // 赤伝票に order_items をコピー
    for (const item of originalItems) {
      await client.query(
        `INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price, item_name, status)
         VALUES ($1, $2, $3, $4, $5, 'pending')`,
        [redOrderId, item.menu_item_id, item.quantity, item.unit_price, item.item_name]
      );
    }

    await client.query('COMMIT');

    // 赤伝票は status='open' で作られるため、他端末の一覧に即座に現れる必要がある。
    // 通知しないと、伝票を取消した端末以外は画面を移動するまで気付けない
    broadcast('orders:changed', { tableId: order.table_id });

    res.json({ voidOrderId, redOrderId });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;
