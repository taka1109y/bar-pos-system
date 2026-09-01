'use strict';
// /api/v1/tags — 営業日タグの CRUD とタグ・天候別の営業日比較（Phase 3）
// - タグ本体（tags / business_day_tags）は analyticsdb（ana.query = CRUD 可）
// - 比較(/compare)の日次売上は bardb を pos.query（SELECT のみ）で営業日集計し、タグ・天候と JS で結合する
//   プレースホルダ順は [start, end, TZ, B] を厳守
// - 分類は営業日(business_date)単位。「営業日」= 期間内に会計が1件以上ある営業日（bardb 実績ベース）
// - CSV 出力(routes/export.js)から再利用できるよう、fetch 群を末尾で追加 export する
const express = require('express');
const pos = require('../db/pos');
const ana = require('../db/ana');
const posDefs = require('../lib/posDefs');
const bd = require('../lib/businessDay');
const { withMeta } = require('../lib/withMeta');
const sales = require('./sales');

const router = express.Router();

const { PAID_FILTER } = posDefs;

// パラメータ化 SQL 断片（$1=start, $2=end, $3=TZ, $4=B。sales.js と同じ式）
const RANGE_W = bd.rangeWhereParam('o.closed_at');
const DATE_B = bd.dateExprParam('o.closed_at');

const TAG_GROUPS = ['event', 'match', 'holiday', 'campaign', 'weather', 'other']; // 0001_init の CHECK と同値
const COLORS = ['neutral', 'info', 'success', 'warning', 'danger'];
const WEATHERS = ['sunny', 'cloudy', 'rain', 'heavy_rain', 'snow'];
const WEATHER_LABELS = { sunny: '晴れ', cloudy: '曇り', rain: '雨', heavy_rain: '大雨', snow: '雪' };

const TAG_COLUMNS = 'id, code, name, tag_group, color, is_active';

const COMPARE_NOTE =
  '営業日 = 期間内に会計が1件以上ある営業日。平均は営業日単位の平均（客単価のみ 合計売上 ÷ 合計客数）。' +
  'baseline は期間内の全営業日平均';

function badRequest(error) {
  return { status: 400, error };
}

// meta に付与する共通情報（sales.js の metaExtra と同じ形）
function metaExtra(ctx, note) {
  return { day_mode: ctx.dayMode, boundary_hour: ctx.boundaryHour, ...(note ? { note } : {}) };
}

function round1(v) {
  return Math.round(v * 10) / 10;
}

// ---- 入力検証（不正なら {status, error} を throw する既存流儀）----

function parseId(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw badRequest('id は正の整数を指定してください');
  return n;
}

function parseCode(v) {
  if (typeof v !== 'string' || !/^[a-z0-9_-]{1,32}$/.test(v)) {
    throw badRequest('code は英小文字・数字・ハイフン・アンダースコア 1〜32 文字で指定してください');
  }
  return v;
}

function parseName(v) {
  if (typeof v !== 'string' || v.trim() === '' || v.trim().length > 50) {
    throw badRequest('name は 1〜50 文字で指定してください');
  }
  return v.trim();
}

function parseTagGroup(v) {
  if (v === undefined || v === null || v === '') return null;
  if (!TAG_GROUPS.includes(v)) throw badRequest(`tag_group は ${TAG_GROUPS.join(' / ')} のいずれかを指定してください`);
  return v;
}

function parseColor(v) {
  if (v === undefined || v === null || v === '') return 'neutral';
  if (!COLORS.includes(v)) throw badRequest(`color は ${COLORS.join(' / ')} のいずれかを指定してください`);
  return v;
}

function parseIsActive(v) {
  if (typeof v !== 'boolean') throw badRequest('is_active は true / false を指定してください');
  return v;
}

// PATCH で更新を許可する列とバリデータ（settings.js と同じ流儀）
const PATCH_ALLOWED = {
  code: parseCode,
  name: parseName,
  tag_group: parseTagGroup,
  color: parseColor,
  is_active: parseIsActive,
};

// ---- fetch 群 ----

// タグ一覧（used_days = business_day_tags での使用日数）
async function fetchTagRows() {
  const { rows } = await ana.query(
    `SELECT t.id, t.code, t.name, t.tag_group, t.color, t.is_active,
            COUNT(bt.business_date)::int AS used_days
     FROM tags t
     LEFT JOIN business_day_tags bt ON bt.tag_id = t.id
     GROUP BY t.id, t.code, t.name, t.tag_group, t.color, t.is_active
     ORDER BY t.id`
  );
  return rows;
}

// グループ内営業日の平均（days = [{revenue, order_count, guest_count}]）
function groupStats(days) {
  const n = days.length;
  const sum = (k) => days.reduce((acc, d) => acc + d[k], 0);
  const revenue = sum('revenue');
  const orderCount = sum('order_count');
  const guestCount = sum('guest_count');
  return {
    days: n,
    avg_revenue: n > 0 ? Math.round(revenue / n) : 0,
    avg_order_count: n > 0 ? round1(orderCount / n) : 0,
    avg_guest_count: n > 0 ? round1(guestCount / n) : 0,
    avg_per_guest: guestCount > 0 ? Math.round(revenue / guestCount) : 0,
  };
}

// タグ・天候別の営業日比較。tagCode 指定時は with/without の2群、無指定は by_tag / by_weather / baseline
async function fetchCompareData(start, end, B, tagCode) {
  const params = [start, end, bd.TZ, B];
  const [posQ, tagQ, weatherQ] = await Promise.all([
    pos.query(
      `SELECT ${DATE_B}::text AS date,
              COALESCE(SUM(o.total_amount), 0)::float AS revenue,
              COUNT(*)::int AS order_count,
              COALESCE(SUM(o.guest_count), 0)::int AS guest_count
       FROM orders o
       WHERE ${PAID_FILTER} AND ${RANGE_W}
       GROUP BY 1`,
      params
    ),
    ana.query(
      `SELECT bt.business_date::text AS date, t.id AS tag_id, t.code, t.name
       FROM business_day_tags bt
       JOIN tags t ON t.id = bt.tag_id
       WHERE bt.business_date BETWEEN $1 AND $2`,
      [start, end]
    ),
    ana.query(
      `SELECT business_date::text AS date, weather
       FROM business_days
       WHERE business_date BETWEEN $1 AND $2 AND weather IS NOT NULL`,
      [start, end]
    ),
  ]);
  const salesDays = posQ.rows; // 営業日 = 会計が1件以上ある営業日
  const salesMap = new Map(salesDays.map((r) => [r.date, r]));

  if (tagCode) {
    const { rows: [tag] } = await ana.query(`SELECT ${TAG_COLUMNS} FROM tags WHERE code = $1`, [tagCode]);
    if (!tag) throw { status: 404, error: `タグが見つかりません: ${tagCode}` };
    const tagged = new Set(tagQ.rows.filter((r) => r.tag_id === tag.id).map((r) => r.date));
    const withDays = salesDays.filter((d) => tagged.has(d.date));
    const withoutDays = salesDays.filter((d) => !tagged.has(d.date));
    return {
      tag: { id: tag.id, code: tag.code, name: tag.name },
      groups: [
        { key: 'with', label: tag.name, ...groupStats(withDays) },
        { key: 'without', label: `${tag.name}以外`, ...groupStats(withoutDays) },
      ],
    };
  }

  // by_tag: 期間内の営業日に1日以上付いているタグのみ
  const byTagMap = new Map();
  for (const r of tagQ.rows) {
    const day = salesMap.get(r.date);
    if (!day) continue;
    if (!byTagMap.has(r.tag_id)) byTagMap.set(r.tag_id, { tag_id: r.tag_id, code: r.code, name: r.name, days: [] });
    byTagMap.get(r.tag_id).days.push(day);
  }
  const byTag = [...byTagMap.values()]
    .sort((a, b) => a.tag_id - b.tag_id)
    .map((t) => ({ tag_id: t.tag_id, code: t.code, name: t.name, ...groupStats(t.days) }));

  const byWeatherMap = new Map();
  for (const r of weatherQ.rows) {
    const day = salesMap.get(r.date);
    if (!day) continue;
    if (!byWeatherMap.has(r.weather)) byWeatherMap.set(r.weather, []);
    byWeatherMap.get(r.weather).push(day);
  }
  const byWeather = WEATHERS.filter((w) => byWeatherMap.has(w))
    .map((w) => ({ weather: w, label: WEATHER_LABELS[w], ...groupStats(byWeatherMap.get(w)) }));

  return { by_tag: byTag, by_weather: byWeather, baseline: groupStats(salesDays) };
}

// ---- エンドポイント ----

// GET /api/v1/tags
router.get('/', async (req, res, next) => {
  try {
    res.json(await withMeta({ rows: await fetchTagRows() }));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/tags/compare[?tag=code]
router.get('/compare', async (req, res, next) => {
  try {
    const ctx = await sales.resolveContext(req.query);
    const tagCode = req.query.tag !== undefined && req.query.tag !== '' ? String(req.query.tag) : null;
    const data = await fetchCompareData(ctx.start, ctx.end, ctx.B, tagCode);
    res.json(await withMeta({ start: ctx.start, end: ctx.end, ...data }, metaExtra(ctx, COMPARE_NOTE)));
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/tags { code, name, tag_group, color }
router.post('/', async (req, res, next) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const code = parseCode(body.code);
    const name = parseName(body.name);
    const tagGroup = parseTagGroup(body.tag_group);
    const color = parseColor(body.color);
    const { rows: [row] } = await ana.query(
      `INSERT INTO tags (code, name, tag_group, color) VALUES ($1, $2, $3, $4) RETURNING ${TAG_COLUMNS}`,
      [code, name, tagGroup, color]
    );
    res.status(201).json(await withMeta({ tag: { ...row, used_days: 0 } }));
  } catch (err) {
    if (err.code === '23505') { // unique_violation
      return res.status(409).json({ error: '同じ code のタグが既にあります' });
    }
    next(err);
  }
});

// PATCH /api/v1/tags/:id（部分更新。無効化は is_active=false）
router.patch('/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const updates = {};
    for (const [key, value] of Object.entries(body)) {
      if (!(key in PATCH_ALLOWED)) continue; // 許可外の列は無視（settings.js と同じ流儀）
      updates[key] = PATCH_ALLOWED[key](value);
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: '更新可能な項目がありません', allowed: Object.keys(PATCH_ALLOWED) });
    }
    const keys = Object.keys(updates);
    const sets = keys.map((k, i) => `${k} = $${i + 2}`);
    const { rows: [row] } = await ana.query(
      `UPDATE tags SET ${sets.join(', ')} WHERE id = $1 RETURNING ${TAG_COLUMNS}`,
      [id, ...keys.map((k) => updates[k])]
    );
    if (!row) return res.status(404).json({ error: `タグが見つかりません: id=${id}` });
    res.json(await withMeta({ tag: row }));
  } catch (err) {
    if (err.code === '23505') { // unique_violation
      return res.status(409).json({ error: '同じ code のタグが既にあります' });
    }
    next(err);
  }
});

// DELETE /api/v1/tags/:id（使用日数>0 は 409。無効化は PATCH is_active=false で）
router.delete('/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const { rows: [used] } = await ana.query(
      'SELECT COUNT(*)::int AS used_days FROM business_day_tags WHERE tag_id = $1', [id]
    );
    if (used.used_days > 0) {
      return res.status(409).json({
        error: `使用中のタグは削除できません（使用日数 ${used.used_days}）。無効化する場合は PATCH で is_active=false にしてください`,
        used_days: used.used_days,
      });
    }
    const { rowCount } = await ana.query('DELETE FROM tags WHERE id = $1', [id]);
    if (rowCount === 0) return res.status(404).json({ error: `タグが見つかりません: id=${id}` });
    res.json(await withMeta({ deleted: true, id }));
  } catch (err) {
    next(err);
  }
});

module.exports = router;

// CSV 出力(routes/export.js)から同一定義を再利用するための追加 export（sales.js と同じ流儀）
module.exports.fetchTagRows = fetchTagRows;
module.exports.fetchCompareData = fetchCompareData;
module.exports.WEATHER_LABELS = WEATHER_LABELS;
