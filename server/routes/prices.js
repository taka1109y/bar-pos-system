const express = require('express');
const router = express.Router();
const { query } = require('../db/database');
const { TZ } = require('../utils/time');
const { clampInt } = require('../utils/validate');

// GET /api/prices
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT
        m.id, m.name,
        m.base_price::float,
        m.current_price::float,
        ROUND((m.current_price - m.base_price) * 100.0 / m.base_price, 1)::float AS pct_change,
        COALESCE(dh.day_high, m.current_price)::float AS day_high,
        COALESCE(dh.day_low,  m.current_price)::float AS day_low
      FROM menu_items m
      LEFT JOIN (
        SELECT menu_item_id,
          MAX(price)::float AS day_high,
          MIN(price)::float AS day_low
        FROM price_history
        WHERE (recorded_at AT TIME ZONE $1)::date = (NOW() AT TIME ZONE $1)::date
        GROUP BY menu_item_id
      ) dh ON dh.menu_item_id = m.id
      WHERE m.is_drink = TRUE AND m.is_active = TRUE
      ORDER BY m.id
    `, [TZ]);

    const withDirection = rows.map((item) => ({
      ...item,
      direction: item.pct_change > 0 ? 'up' : item.pct_change < 0 ? 'down' : 'flat',
    }));

    res.json(withDirection);
  } catch (err) {
    next(err);
  }
});

// GET /api/prices/:id/history?limit=30
router.get('/:id/history', async (req, res, next) => {
  try {
    const limit = clampInt(req.query.limit, 1, 1000, 30);
    const { rows } = await query(
      `SELECT price::float, recorded_at
       FROM price_history
       WHERE menu_item_id = $1
       ORDER BY recorded_at DESC
       LIMIT $2`,
      [req.params.id, limit]
    );
    res.json(rows.reverse());
  } catch (err) {
    next(err);
  }
});

module.exports = router;
