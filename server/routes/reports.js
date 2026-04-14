const express = require('express');
const router = express.Router();
const { query } = require('../db/database');

const TZ = process.env.TZ_REPORT || 'Asia/Tokyo';

function todayJST() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: TZ }); // YYYY-MM-DD
}

// GET /api/reports/daily?date=YYYY-MM-DD[&since=ISO_TIMESTAMP]
router.get('/daily', async (req, res, next) => {
  try {
    const date  = req.query.date  || todayJST();
    // since: レジオープン時刻。指定された場合はそれ以降の会計のみ集計する
    const since = req.query.since || null;

    const baseWhere = since
      ? `status = 'paid' AND (closed_at AT TIME ZONE $2)::date = $1 AND closed_at >= $3`
      : `status = 'paid' AND (closed_at AT TIME ZONE $2)::date = $1`;
    const params = since ? [date, TZ, since] : [date, TZ];

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
         COALESCE(SUM(total_amount) FILTER (WHERE payment_method = 'emoney'), 0)::float AS emoney_revenue,
         COALESCE(SUM(guest_count), 0)::int           AS guest_count,
         COALESCE(SUM(tax_amount), 0)::float           AS total_tax,
         COALESCE(SUM(charge_amount), 0)::float        AS total_charge,
         COUNT(*) FILTER (WHERE charge_amount > 0)::int          AS charge_count,
         COUNT(*) FILTER (WHERE discount_amount > 0)::int        AS discount_count,
         COUNT(*) FILTER (WHERE late_night_amount > 0)::int      AS late_night_count,
         COALESCE(SUM(gift_cert_amount) FILTER (WHERE gift_cert_no_change = true), 0)::float                       AS gift_no_change_amount,
         COUNT(*) FILTER (WHERE gift_cert_no_change = true AND gift_cert_amount > 0)::int                          AS gift_no_change_count,
         COALESCE(SUM(gift_cert_amount) FILTER (WHERE gift_cert_no_change = false AND gift_cert_amount > 0), 0)::float AS gift_change_amount,
         COUNT(*) FILTER (WHERE gift_cert_no_change = false AND gift_cert_amount > 0)::int                         AS gift_change_count
       FROM orders
       WHERE ${baseWhere}`,
      params
    );

    const { rows: items } = await query(
      `SELECT
         oi.item_name AS name,
         SUM(oi.quantity)::int AS quantity_sold,
         SUM(oi.quantity * oi.unit_price)::float AS revenue
       FROM order_items oi
       JOIN orders o ON oi.order_id = o.id
       WHERE o.${baseWhere}
       GROUP BY oi.item_name
       ORDER BY revenue DESC`,
      params
    );

    const orderCount = parseInt(summary[0].order_count);

    const s = summary[0];
    const guestCount = parseInt(s.guest_count);
    res.json({
      date,
      total_revenue:         s.total_revenue,
      order_count:           orderCount,
      avg_order_value:       orderCount > 0 ? Math.round(s.total_revenue / orderCount) : 0,
      guest_count:           guestCount,
      avg_per_guest:         guestCount > 0 ? Math.round(s.total_revenue / guestCount) : 0,
      total_tax:             s.total_tax,
      total_discount:        s.total_discount,
      discount_count:        s.discount_count,
      total_gift_cert:       s.total_gift_cert,
      total_late_night:      s.total_late_night,
      late_night_count:      s.late_night_count,
      total_charge:          s.total_charge,
      charge_count:          s.charge_count,
      gift_no_change_amount: s.gift_no_change_amount,
      gift_no_change_count:  s.gift_no_change_count,
      gift_change_amount:    s.gift_change_amount,
      gift_change_count:     s.gift_change_count,
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
