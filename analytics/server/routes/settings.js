'use strict';
// /api/v1/settings — store_settings（1行固定）の参照・更新
const express = require('express');
const ana = require('../db/ana');
const { withMeta, invalidateMeta } = require('../lib/withMeta');

const router = express.Router();

const COLUMNS = `id, business_day_boundary_hour, fiscal_year_start_month, week_start_dow, default_day_mode,
  abc_a_pct, abc_b_pct, include_owner_labor, open_hour32, close_hour32, updated_at`;

const BOUNDARY_WARNING =
  '営業日境界を変更すると、過去分も含めて営業日ベースの集計（日次・週次・月次・レジ精算の紐付け）の区切りが変わります。' +
  '暦日ベースの集計と POS 本体のレポートには影響しません。';

function intIn(min, max) {
  return (v) => (Number.isInteger(v) && v >= min && v <= max ? null : `${min}〜${max} の整数を指定してください`);
}
function oneOf(values) {
  return (v) => (values.includes(v) ? null : `${values.join(' / ')} のいずれかを指定してください`);
}
function bool(v) {
  return typeof v === 'boolean' ? null : 'true / false を指定してください';
}

// 更新を許可する列とバリデータ
const ALLOWED = {
  business_day_boundary_hour: intIn(0, 12),
  fiscal_year_start_month: intIn(1, 12),
  week_start_dow: intIn(0, 6),
  default_day_mode: oneOf(['business', 'calendar']),
  abc_a_pct: intIn(1, 99),
  abc_b_pct: intIn(2, 100),
  include_owner_labor: bool,
  open_hour32: intIn(0, 35),
  close_hour32: intIn(1, 36),
};

async function loadSettings() {
  const { rows: [row] } = await ana.query(`SELECT ${COLUMNS} FROM store_settings WHERE id = 1`);
  return row || null;
}

// GET /api/v1/settings
router.get('/', async (req, res, next) => {
  try {
    const row = await loadSettings();
    if (!row) return res.status(500).json({ error: 'store_settings が初期化されていません' });
    res.json(await withMeta(row));
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/settings
router.patch('/', async (req, res, next) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const errors = {};
    const updates = {};
    for (const [key, value] of Object.entries(body)) {
      if (!(key in ALLOWED)) continue; // 許可外の列は無視
      const msg = ALLOWED[key](value);
      if (msg) errors[key] = msg;
      else updates[key] = value;
    }
    if (Object.keys(errors).length > 0) {
      return res.status(400).json({ error: '入力値が不正です', fields: errors });
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: '更新可能な項目がありません', allowed: Object.keys(ALLOWED) });
    }

    const current = await loadSettings();
    if (!current) return res.status(500).json({ error: 'store_settings が初期化されていません' });

    // 組み合わせ検証（更新後の値で判定）
    const next_ = { ...current, ...updates };
    if (next_.abc_a_pct >= next_.abc_b_pct) {
      return res.status(400).json({ error: 'abc_a_pct は abc_b_pct より小さくしてください' });
    }
    if (next_.open_hour32 >= next_.close_hour32) {
      return res.status(400).json({ error: 'open_hour32 は close_hour32 より小さくしてください' });
    }

    const keys = Object.keys(updates);
    const sets = keys.map((k, i) => `${k} = $${i + 1}`);
    const { rows: [row] } = await ana.query(
      `UPDATE store_settings SET ${sets.join(', ')}, updated_at = NOW() WHERE id = 1 RETURNING ${COLUMNS}`,
      keys.map((k) => updates[k])
    );
    invalidateMeta();

    const payload = { ...row };
    if ('business_day_boundary_hour' in updates
        && updates.business_day_boundary_hour !== current.business_day_boundary_hour) {
      payload.warning = BOUNDARY_WARNING;
    }
    res.json(await withMeta(payload));
  } catch (err) {
    if (err.code === '23514') { // check_violation
      return res.status(400).json({ error: '値が許容範囲外です', detail: err.constraint || null });
    }
    next(err);
  }
});

module.exports = router;
