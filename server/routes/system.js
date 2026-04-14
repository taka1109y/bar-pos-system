const express = require('express');
const router = express.Router();
const { query } = require('../db/database');

function parseSettings(rows) {
  const s = rows.reduce((acc, r) => { acc[r.key] = r.value; return acc; }, {});
  return {
    tax_rate:            parseFloat(s.tax_rate           ?? '0.10'),
    late_night_rate:     parseFloat(s.late_night_rate    ?? '0.10'),
    late_night_start:    parseInt(  s.late_night_start   ?? '22', 10),
    late_night_end:      parseInt(  s.late_night_end     ?? '29', 10),
    charge_enabled:      s.charge_enabled !== 'false',
    charge_time_slots:   (() => { try { return JSON.parse(s.charge_time_slots ?? '[]'); } catch { return []; } })(),
    register_open_cash:  parseInt(  s.register_open_cash ?? '0',  10),
    register_open:       s.register_open === 'true',
    register_opened_at:  s.register_opened_at ?? null,
  };
}

// GET /api/system/settings
router.get('/settings', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT key, value FROM system_settings');
    res.json(parseSettings(rows));
  } catch (err) {
    next(err);
  }
});

// PATCH /api/system/settings
router.patch('/settings', async (req, res, next) => {
  try {
    const numericKeys = ['tax_rate', 'late_night_rate'];
    const hourKeys    = ['late_night_start', 'late_night_end'];

    for (const key of numericKeys) {
      if (req.body[key] === undefined) continue;
      const n = parseFloat(req.body[key]);
      if (isNaN(n) || n < 0 || n > 1) return res.status(400).json({ error: `${key} must be 0–1` });
      await query(
        `INSERT INTO system_settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [key, String(n)]
      );
    }

    for (const key of hourKeys) {
      if (req.body[key] === undefined) continue;
      const n = parseInt(req.body[key], 10);
      if (isNaN(n) || n < 0 || n > 32) return res.status(400).json({ error: `${key} must be 0–32` });
      await query(
        `INSERT INTO system_settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [key, String(n)]
      );
    }

    if (req.body.charge_enabled !== undefined) {
      await query(
        `INSERT INTO system_settings (key, value) VALUES ('charge_enabled', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [req.body.charge_enabled ? 'true' : 'false']
      );
    }

    if (req.body.charge_time_slots !== undefined) {
      const slots = req.body.charge_time_slots;
      if (!Array.isArray(slots)) return res.status(400).json({ error: 'charge_time_slots must be array' });
      for (const s of slots) {
        if (typeof s.start !== 'number' || typeof s.end !== 'number' || typeof s.amount !== 'number') {
          return res.status(400).json({ error: 'Each slot must have start, end, amount (numbers)' });
        }
        if (s.start >= s.end) return res.status(400).json({ error: 'slot start must be < end' });
        if (s.amount < 0)     return res.status(400).json({ error: 'slot amount must be >= 0' });
      }
      await query(
        `INSERT INTO system_settings (key, value) VALUES ('charge_time_slots', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [JSON.stringify(slots)]
      );
    }

    if (req.body.register_open !== undefined) {
      await query(
        `INSERT INTO system_settings (key, value) VALUES ('register_open', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [req.body.register_open ? 'true' : 'false']
      );
      // オープン時はセッション開始タイムスタンプを記録する
      if (req.body.register_open) {
        await query(
          `INSERT INTO system_settings (key, value) VALUES ('register_opened_at', $1)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
          [new Date().toISOString()]
        );
      }
    }

    if (req.body.register_open_cash !== undefined) {
      const n = parseInt(req.body.register_open_cash, 10);
      if (isNaN(n) || n < 0) return res.status(400).json({ error: 'register_open_cash must be >= 0' });
      await query(
        `INSERT INTO system_settings (key, value) VALUES ('register_open_cash', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [String(n)]
      );
    }

    const { rows } = await query('SELECT key, value FROM system_settings');
    res.json(parseSettings(rows));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
