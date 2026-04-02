const express = require('express');
const router = express.Router();
const { query } = require('../db/database');

// GET /api/receipts?date=YYYY-MM-DD
router.get('/', async (req, res, next) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const date = req.query.date || today;

    const { rows } = await query(
      `SELECT
         o.id,
         o.closed_at,
         o.total_amount::float,
         o.discount_amount::float,
         o.late_night_rate::float,
         o.late_night_amount::float,
         o.tax_rate::float,
         o.tax_amount::float,
         o.payment_method,
         t.name AS table_name,
         json_agg(
           json_build_object(
             'item_name', oi.item_name,
             'quantity',  oi.quantity,
             'unit_price', oi.unit_price::float
           ) ORDER BY oi.id
         ) AS items
       FROM orders o
       JOIN tables t ON o.table_id = t.id
       LEFT JOIN order_items oi ON oi.order_id = o.id
       WHERE o.status = 'paid' AND o.closed_at::date = $1
       GROUP BY o.id, o.closed_at, o.total_amount, o.discount_amount, o.late_night_rate, o.late_night_amount, o.tax_rate, o.tax_amount, o.payment_method, t.name
       ORDER BY o.closed_at DESC`,
      [date]
    );

    res.json(rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
