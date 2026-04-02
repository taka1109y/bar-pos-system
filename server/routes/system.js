const express = require('express');
const router = express.Router();
const { query } = require('../db/database');

// GET /api/system/settings
router.get('/settings', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT key, value FROM system_settings');
    const s = rows.reduce((acc, r) => { acc[r.key] = r.value; return acc; }, {});
    res.json({
      tax_rate:         parseFloat(s.tax_rate         ?? '0.10'),
      late_night_rate:  parseFloat(s.late_night_rate  ?? '0.10'),
      late_night_start: parseInt(  s.late_night_start ?? '22', 10),
      late_night_end:   parseInt(  s.late_night_end   ?? '29', 10),
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/system/settings
router.patch('/settings', async (req, res, next) => {
  try {
    const allowed = ['tax_rate', 'late_night_rate', 'late_night_start', 'late_night_end'];
    const updates = [];

    for (const key of allowed) {
      if (req.body[key] === undefined) continue;
      const val = req.body[key];

      if (key === 'tax_rate' || key === 'late_night_rate') {
        const n = parseFloat(val);
        if (isNaN(n) || n < 0 || n > 1) return res.status(400).json({ error: `${key} must be 0–1` });
        updates.push({ key, value: String(n) });
      } else {
        const n = parseInt(val, 10);
        if (isNaN(n) || n < 0 || n > 32) return res.status(400).json({ error: `${key} must be 0–32` });
        updates.push({ key, value: String(n) });
      }
    }

    for (const { key, value } of updates) {
      await query(
        `INSERT INTO system_settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [key, value]
      );
    }

    // 保存後の全設定を返す
    const { rows } = await query('SELECT key, value FROM system_settings');
    const s = rows.reduce((acc, r) => { acc[r.key] = r.value; return acc; }, {});
    res.json({
      tax_rate:         parseFloat(s.tax_rate         ?? '0.10'),
      late_night_rate:  parseFloat(s.late_night_rate  ?? '0.10'),
      late_night_start: parseInt(  s.late_night_start ?? '22', 10),
      late_night_end:   parseInt(  s.late_night_end   ?? '29', 10),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
