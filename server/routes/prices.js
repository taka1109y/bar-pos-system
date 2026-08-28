const express = require('express');
const router = express.Router();
const { query } = require('../db/database');
const { TZ } = require('../utils/time');
const { clampInt } = require('../utils/validate');
const pm = require('../services/pricingModel');

// GET /api/prices
router.get('/', async (req, res, next) => {
  try {
    // 「同日高値/底値」の集計起点。バーは深夜を跨ぐため、暦日ではなくレジオープン(register_opened_at)
    // からの営業セッションを基準にする(レジ日計 /reports/daily の since と同じ考え方)。
    // レジ未オープン時は register_opened_at を使わず、暦日(JSTの今日)にフォールバックする。
    const { rows: setRows } = await query(
      `SELECT key, value FROM system_settings WHERE key IN ('register_open','register_opened_at')`
    );
    const smap = Object.fromEntries(setRows.map((r) => [r.key, r.value]));
    const sessionStart = (smap.register_open === 'true' && smap.register_opened_at) ? smap.register_opened_at : null;

    const { rows } = await query(`
      SELECT
        m.id, m.name,
        m.base_price::float,
        m.current_price::float,
        m.min_price::float,
        m.max_price::float,
        m.engine_enabled, m.price_editable, m.is_crashed,
        COALESCE(ROUND((m.current_price - m.base_price) * 100.0 / NULLIF(m.base_price, 0), 1), 0)::float AS pct_change,
        COALESCE(dh.day_high, m.current_price)::float AS day_high,
        COALESCE(dh.day_low,  m.current_price)::float AS day_low,
        c.id AS category_id,
        c.name AS category_name
      FROM menu_items m
      JOIN categories c ON m.category_id = c.id
      LEFT JOIN subcategories sc ON m.subcategory_id = sc.id
      LEFT JOIN (
        SELECT menu_item_id,
          MAX(price)::float AS day_high,
          MIN(price)::float AS day_low
        FROM price_history
        -- レジオープン以降($2)。$2 が NULL(未オープン)なら JST の当日0時から。
        WHERE recorded_at >= COALESCE($2::timestamptz, (date_trunc('day', NOW() AT TIME ZONE $1) AT TIME ZONE $1))
        GROUP BY menu_item_id
      ) dh ON dh.menu_item_id = m.id
      WHERE m.is_drink = TRUE AND m.is_active = TRUE AND m.is_staff_only = FALSE
      ORDER BY c.sort_order, sc.sort_order NULLS LAST, m.sort_order, m.name
    `, [TZ, sessionStart]);

    // 表示は「寄り付き価格(pricing_base=中心)比」の n/center_pct で行う(定価比 pct_change は互換のため残置)。
    const withDisplay = rows.map((item) => {
      const d = pm.displayInfo(item.base_price, item.current_price, item);
      return {
        ...item,
        ...d, // pricing_base, n, center_pct, variable
        direction: d.n > 0 ? 'up' : d.n < 0 ? 'down' : 'flat', // 中心比の符号
      };
    });

    res.json(withDisplay);
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
