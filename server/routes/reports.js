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
         COALESCE(SUM(total_amount), 0)::float        AS total_revenue,
         COALESCE(SUM(discount_amount), 0)::float     AS total_discount,
         COALESCE(SUM(gift_cert_amount), 0)::float    AS total_gift_cert,
         COALESCE(SUM(late_night_amount), 0)::float   AS total_late_night,
         COUNT(*) FILTER (WHERE payment_method = 'cash')::int    AS cash_count,
         COUNT(*) FILTER (WHERE payment_method = 'card')::int    AS card_count,
         COUNT(*) FILTER (WHERE payment_method = 'emoney')::int  AS emoney_count,
         COALESCE(SUM(total_amount) FILTER (WHERE payment_method = 'cash'), 0)::float   AS cash_revenue,
         COALESCE(SUM(total_amount) FILTER (WHERE payment_method = 'card'), 0)::float   AS card_revenue,
         COALESCE(SUM(total_amount) FILTER (WHERE payment_method = 'emoney'), 0)::float AS emoney_revenue
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

    const s = summary[0];
    res.json({
      date,
      total_revenue:    s.total_revenue,
      order_count:      orderCount,
      avg_order_value:  orderCount > 0 ? Math.round(s.total_revenue / orderCount) : 0,
      total_discount:   s.total_discount,
      total_gift_cert:  s.total_gift_cert,
      total_late_night: s.total_late_night,
      payment_breakdown: [
        { method: 'cash',   label: '現金',       count: s.cash_count,   revenue: s.cash_revenue },
        { method: 'card',   label: 'カード',     count: s.card_count,   revenue: s.card_revenue },
        { method: 'emoney', label: '電子マネー', count: s.emoney_count, revenue: s.emoney_revenue },
      ],
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
