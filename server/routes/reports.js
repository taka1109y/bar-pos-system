const express = require('express');
const router = express.Router();
const { query } = require('../db/database');

const TZ = process.env.TZ_REPORT || 'Asia/Tokyo';

function todayJST() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: TZ }); // YYYY-MM-DD
}

// GET /api/reports/daily?date=YYYY-MM-DD
router.get('/daily', async (req, res, next) => {
  try {
    const date = req.query.date || todayJST();

    const { rows: summary } = await query(
      `SELECT
         COUNT(*) AS order_count,
         COALESCE(SUM(total_amount), 0)::float AS total_revenue
       FROM orders
       WHERE status = 'paid' AND (closed_at AT TIME ZONE $2)::date = $1`,
      [date, TZ]
    );

    const { rows: items } = await query(
      `SELECT
         oi.item_name AS name,
         SUM(oi.quantity)::int AS quantity_sold,
         SUM(oi.quantity * oi.unit_price)::float AS revenue
       FROM order_items oi
       JOIN orders o ON oi.order_id = o.id
       WHERE o.status = 'paid' AND (o.closed_at AT TIME ZONE $2)::date = $1
       GROUP BY oi.item_name
       ORDER BY revenue DESC`,
      [date, TZ]
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
    const today = todayJST();
    const start = req.query.start || today;
    const end = req.query.end || today;

    const { rows: items } = await query(
      `SELECT
         oi.item_name AS name,
         SUM(oi.quantity)::int AS quantity_sold,
         SUM(oi.quantity * oi.unit_price)::float AS revenue
       FROM order_items oi
       JOIN orders o ON oi.order_id = o.id
       WHERE o.status = 'paid'
         AND (o.closed_at AT TIME ZONE $3)::date BETWEEN $1 AND $2
       GROUP BY oi.item_name
       ORDER BY revenue DESC`,
      [start, end, TZ]
    );

    res.json({ start, end, items });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
