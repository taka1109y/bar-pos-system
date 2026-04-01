const express = require('express');
const router = express.Router();
const { query } = require('../db/database');

// GET /api/prices
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT id, name,
        base_price::float,
        current_price::float,
        ROUND((current_price - base_price) * 100.0 / base_price, 1)::float AS pct_change
      FROM menu_items
      WHERE is_drink = TRUE AND is_active = TRUE
      ORDER BY id
    `);

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
    const limit = parseInt(req.query.limit) || 30;
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
