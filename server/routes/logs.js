const express = require('express');
const router = express.Router();
const { pool } = require('../db/database');
const { TZ } = require('../utils/time');
const { assertDateFormat, clampInt } = require('../utils/validate');

const VALID_RECEIPT_TYPES   = new Set(['normal', 'red', 'void', 'black_cancelled']);
const VALID_PAYMENT_METHODS = new Set(['cash', 'card', 'emoney']);

// GET /api/logs?from=YYYY-MM-DD&to=YYYY-MM-DD&receipt_type=all&payment_method=all&limit=50&offset=0
router.get('/', async (req, res, next) => {
  try {
    const { from, to, receipt_type, payment_method } = req.query;
    const limit  = clampInt(req.query.limit,  1, 200, 50);
    const offset = clampInt(req.query.offset, 0, 1000000, 0);

    if (from) assertDateFormat(from, 'from');
    if (to)   assertDateFormat(to,   'to');

    // $1 = タイムゾーン文字列（WHERE・SELECTで共用）
    const params = [TZ];
    const conditions = ["o.status = 'paid'"];

    if (from) {
      params.push(from);
      conditions.push(`(o.closed_at AT TIME ZONE $1)::date >= $${params.length}::date`);
    }
    if (to) {
      params.push(to);
      conditions.push(`(o.closed_at AT TIME ZONE $1)::date <= $${params.length}::date`);
    }
    if (receipt_type && VALID_RECEIPT_TYPES.has(receipt_type)) {
      params.push(receipt_type);
      conditions.push(`o.receipt_type = $${params.length}`);
    }
    if (payment_method && VALID_PAYMENT_METHODS.has(payment_method)) {
      params.push(payment_method);
      conditions.push(`o.payment_method = $${params.length}`);
    }

    const where = 'WHERE ' + conditions.join(' AND ');

    const { rows: [{ total }] } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM orders o ${where}`,
      params
    );

    const { rows: orders } = await pool.query(
      `SELECT o.id,
              t.name                AS table_name,
              o.opened_at,
              o.closed_at,
              o.payment_method,
              o.total_amount::float,
              o.discount_amount::float,
              o.gift_cert_amount::float,
              o.charge_amount::float,
              o.late_night_amount::float,
              o.guest_count,
              o.receipt_type,
              o.original_order_id,
              o.memo
       FROM orders o
       LEFT JOIN tables t ON t.id = o.table_id
       ${where}
       ORDER BY o.closed_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    res.json({ orders, total, limit, offset });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.error });
    next(err);
  }
});

module.exports = router;
