const express = require('express');
const router = express.Router();
const { query } = require('../db/database');
const pm = require('../services/pricingModel');
const { doMarketOpen } = require('../services/pricingEngine');

const upsertSetting = (key, value) =>
  query(
    `INSERT INTO system_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, String(value)]
  );

function parseSettings(rows) {
  const s = rows.reduce((acc, r) => { acc[r.key] = r.value; return acc; }, {});
  return {
    tax_rate:             parseFloat(s.tax_rate              ?? '0.10'),
    reduced_tax_rate:     parseFloat(s.reduced_tax_rate      ?? '0.08'),
    default_tax_category: s.default_tax_category ?? 'standard',
    late_night_rate:      parseFloat(s.late_night_rate       ?? '0.10'),
    late_night_start:     parseInt(  s.late_night_start      ?? '22', 10),
    late_night_end:       parseInt(  s.late_night_end        ?? '29', 10),
    charge_enabled:       s.charge_enabled !== 'false',
    charge_time_slots:    (() => { try { return JSON.parse(s.charge_time_slots ?? '[]'); } catch { return []; } })(),
    register_open_cash:   parseInt(  s.register_open_cash    ?? '0',  10),
    register_open:        s.register_open === 'true',
    register_opened_at:   s.register_opened_at ?? null,
    monthly_discount_cap: parseInt(  s.monthly_discount_cap ?? '0', 10),
    crash_started_at:     s.crash_started_at ?? null,
    crash_ends_at:        s.crash_ends_at ?? null,
    // 価格モデル(Phase7)の定数（管理画面の「価格モデル」タブ表示用）
    price_model: {
      base_markup: pm.BASE_MARKUP,                          // pricing_base = base × 1.10（帯中心）
      grid_points: pm.GRID_HALF_SPAN * 2 + 1,               // 21点格子(n∈[-10,+10])
      band_pct:    Math.round(pm.GRID_HALF_SPAN * pm.STEP_RATE * 1000) / 10, // 帯 ±20%
      seesaw_dist: pm.SEESAW_DIST,                          // シーソー勝者上昇段の抽選 0.6/0.3/0.1
    },
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
    const numericKeys = ['tax_rate', 'reduced_tax_rate', 'late_night_rate'];
    const hourKeys    = ['late_night_start', 'late_night_end'];

    for (const key of numericKeys) {
      if (req.body[key] === undefined) continue;
      const n = parseFloat(req.body[key]);
      if (isNaN(n) || n < 0 || n > 1) return res.status(400).json({ error: `${key} must be 0–1` });
      await upsertSetting(key, n);
    }

    for (const key of hourKeys) {
      if (req.body[key] === undefined) continue;
      const n = parseInt(req.body[key], 10);
      if (isNaN(n) || n < 0 || n > 32) return res.status(400).json({ error: `${key} must be 0–32` });
      await upsertSetting(key, n);
    }

    if (req.body.default_tax_category !== undefined) {
      const cat = req.body.default_tax_category;
      if (!['standard', 'reduced'].includes(cat)) {
        return res.status(400).json({ error: 'default_tax_category must be standard or reduced' });
      }
      await upsertSetting('default_tax_category', cat);
    }

    if (req.body.charge_enabled !== undefined) {
      await upsertSetting('charge_enabled', req.body.charge_enabled ? 'true' : 'false');
    }

    if (req.body.charge_time_slots !== undefined) {
      const slots = req.body.charge_time_slots;
      if (!Array.isArray(slots)) return res.status(400).json({ error: 'charge_time_slots must be array' });
      if (slots.length > 50) return res.status(400).json({ error: 'charge_time_slots must have 50 or fewer entries' });
      for (const s of slots) {
        if (typeof s.start !== 'number' || typeof s.end !== 'number' || typeof s.amount !== 'number') {
          return res.status(400).json({ error: 'Each slot must have start, end, amount (numbers)' });
        }
        if (s.start >= s.end) return res.status(400).json({ error: 'slot start must be < end' });
        if (s.amount < 0)     return res.status(400).json({ error: 'slot amount must be >= 0' });
      }
      await upsertSetting('charge_time_slots', JSON.stringify(slots));
    }

    if (req.body.register_open !== undefined) {
      const opening = !!req.body.register_open;
      // 現在値を読み、not-true→true の「遷移時」のみ寄り付き・opened_at 更新を行う。
      // 既に open の状態で true を再PATCHしても register_opened_at を上書きしない
      // (当日レポートの since 前進による売上欠落・サージ消失を防ぐ)。再発火は手動 /market-open に限定。
      const { rows: prevRows } = await query(`SELECT value FROM system_settings WHERE key = 'register_open'`);
      const wasOpen = prevRows[0]?.value === 'true';
      await upsertSetting('register_open', opening ? 'true' : 'false');
      if (opening && !wasOpen) {
        await upsertSetting('register_opened_at', new Date().toISOString());
        // Phase7(オーナー指定): レジオープンでは価格をリセットしない(前セッションの価格を持ち越す)。
        // 寄り付き(pricing_base=n=0 へのリセット)はスタッフが手動の /market-open で任意のタイミングに行う。
      }
    }

    if (req.body.register_open_cash !== undefined) {
      const n = parseInt(req.body.register_open_cash, 10);
      if (isNaN(n) || n < 0) return res.status(400).json({ error: 'register_open_cash must be >= 0' });
      await upsertSetting('register_open_cash', n);
    }

    if (req.body.monthly_discount_cap !== undefined) {
      const n = parseInt(req.body.monthly_discount_cap, 10);
      if (isNaN(n) || n < 0) return res.status(400).json({ error: 'monthly_discount_cap must be >= 0' });
      await upsertSetting('monthly_discount_cap', n);
    }

    const { rows } = await query('SELECT key, value FROM system_settings');
    res.json(parseSettings(rows));
  } catch (err) {
    next(err);
  }
});

// POST /api/system/market-open — 手動で寄り付きリセット(確認付き・例外用)。
// engine_enabled のドリンクを anchor へ戻し、期起点を今に合わせる。
router.post('/market-open', async (req, res, next) => {
  try {
    const result = await doMarketOpen('manual');
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
