const express = require('express');
const router = express.Router();
const { query } = require('../db/database');

const TZ = process.env.TZ_REPORT || 'Asia/Tokyo';

function todayJST() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
}

// GET /api/receipts?date=YYYY-MM-DD
router.get('/', async (req, res, next) => {
  try {
    const date = req.query.date || todayJST();

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
         o.memo,
         o.gift_cert_amount::float,
         o.gift_cert_no_change,
         o.charge_per_person::float,
         o.charge_amount::float,
         o.guest_count,
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
       WHERE o.status = 'paid' AND (o.closed_at AT TIME ZONE $2)::date = $1
       GROUP BY o.id, o.closed_at, o.total_amount, o.discount_amount,
                o.late_night_rate, o.late_night_amount, o.tax_rate, o.tax_amount,
                o.payment_method, o.memo, o.gift_cert_amount, o.gift_cert_no_change,
                o.charge_per_person, o.charge_amount, o.guest_count,
                t.name
       ORDER BY o.closed_at DESC`,
      [date, TZ]
    );

    res.json(rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
