const express = require('express');
const router = express.Router();
const { query } = require('../db/database');

const TZ = process.env.TZ_REPORT || 'Asia/Tokyo';

// GET /api/reports/daily?date=YYYY-MM-DD
router.get('/daily', async (req, res, next) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];

    const { rows: summary } = await query(
      `SELECT
         COUNT(*) AS order_count,
         COALESCE(SUM(total_amount), 0)::float AS total_revenue
       FROM orders
       WHERE status = 'paid' AND closed_at::date = $1`,
      [date]
    );

    const { rows: items } = await query(
      `SELECT
         oi.item_name AS name,
         SUM(oi.quantity)::int AS quantity_sold,
         SUM(oi.quantity * oi.unit_price)::float AS revenue
       FROM order_items oi
       JOIN orders o ON oi.order_id = o.id
       WHERE o.status = 'paid' AND o.closed_at::date = $1
       GROUP BY oi.item_name
       ORDER BY revenue DESC`,
      [date]
    );

    const orderCount = parseInt(summary[0].order_count);
    const totalRevenue = summary[0].total_revenue;

    res.json({
      date,
      total_revenue: totalRevenue,
      order_count: orderCount,
      avg_order_value: orderCount > 0 ? Math.round(totalRevenue / orderCount) : 0,
      items,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/items?start=YYYY-MM-DD&end=YYYY-MM-DD
router.get('/items', async (req, res, next) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const start = req.query.start || today;
    const end = req.query.end || today;

    const { rows: items } = await query(
      `SELECT
         oi.item_name AS name,
         SUM(oi.quantity)::int AS quantity_sold,
         SUM(oi.quantity * oi.unit_price)::float AS revenue
       FROM order_items oi
       JOIN orders o ON oi.order_id = o.id
       WHERE o.status = 'paid' AND o.closed_at::date BETWEEN $1 AND $2
       GROUP BY oi.item_name
       ORDER BY revenue DESC`,
      [start, end]
    );

    res.json({ start, end, items });
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/hourly?date=YYYY-MM-DD
router.get('/hourly', async (req, res, next) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];

    const { rows: hourly } = await query(
      `SELECT
         TO_CHAR(closed_at AT TIME ZONE $2, 'HH24') AS hour,
         COUNT(*)::int AS order_count,
         COALESCE(SUM(total_amount), 0)::float AS revenue
       FROM orders
       WHERE status = 'paid' AND closed_at::date = $1
       GROUP BY hour
       ORDER BY hour`,
      [date, TZ]
    );

    res.json({ date, hourly });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
