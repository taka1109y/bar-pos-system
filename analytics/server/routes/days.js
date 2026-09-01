'use strict';
// /api/v1/business-days — 営業日ノート（Phase 3）
// - ノート本体（business_days / business_day_tags）は analyticsdb（ana.query = CRUD 可）
// - bardb 実績（売上・会計件数・客数）は pos.query（SELECT のみ）で営業日集計し JS で結合する
//   プレースホルダ順は [start, end, TZ, B] を厳守
// - PUT はノート upsert とタグ全置換を1トランザクションで行う（bardb には書かない）
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

const WEATHERS = ['sunny', 'cloudy', 'rain', 'heavy_rain', 'snow']; // 0001_init の CHECK と同値
const MAX_TAG_IDS = 20;

const DAYS_NOTE = '未入力日は is_open=null。revenue/order_count/guest_count は bardb の営業日実績';

function badRequest(error) {
  return { status: 400, error };
}

// ---- 入力検証（不正なら {status, error} を throw する既存流儀）----

function parseIsOpen(v) {
  if (typeof v !== 'boolean') throw badRequest('is_open は true / false を指定してください');
  return v;
}

function parseWeather(v) {
  if (v === undefined || v === null || v === '') return null;
  if (!WEATHERS.includes(v)) throw badRequest(`weather は ${WEATHERS.join(' / ')} のいずれかを指定してください`);
  return v;
}

function parseTemperature(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < -50 || n > 50) throw badRequest('temperature_c は -50〜50 の数値を指定してください');
  return Math.round(n * 10) / 10; // NUMERIC(4,1) に合わせて小数第1位へ丸める
}

function parseNote(v) {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw badRequest('note は文字列で指定してください');
  const s = v.trim();
  if (s.length > 2000) throw badRequest('note は 2000 文字以内で指定してください');
  return s === '' ? null : s;
}

function parseTagIds(v) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw badRequest('tag_ids は配列で指定してください');
  const out = [];
  for (const x of v) {
    if (!Number.isInteger(x) || x <= 0) throw badRequest(`tag_ids に正の整数でない値が含まれています: ${x}`);
    if (!out.includes(x)) out.push(x);
  }
  if (out.length > MAX_TAG_IDS) throw badRequest(`tag_ids は ${MAX_TAG_IDS} 件以内で指定してください`);
  return out;
}

// ---- fetch 群（SQL は [start, end, TZ, B] のパラメータ配列で実行する）----

// [start, end] の日別行（暦日で0埋め）。ノート未入力日は is_open=null・tags=[]
async function fetchDaysRange(start, end, B) {
  const params = [start, end, bd.TZ, B];
  const [posQ, anaQ] = await Promise.all([
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
      `SELECT d.business_date::text AS date, d.is_open, d.weather,
              d.temperature_c::float AS temperature_c, d.note,
              COALESCE(
                json_agg(json_build_object('id', t.id, 'code', t.code, 'name', t.name, 'color', t.color) ORDER BY t.id)
                  FILTER (WHERE t.id IS NOT NULL),
                '[]'::json
              ) AS tags
       FROM business_days d
       LEFT JOIN business_day_tags bt ON bt.business_date = d.business_date
       LEFT JOIN tags t ON t.id = bt.tag_id
       WHERE d.business_date BETWEEN $1 AND $2
       GROUP BY d.business_date, d.is_open, d.weather, d.temperature_c, d.note`,
      [start, end]
    ),
  ]);
  const posMap = new Map(posQ.rows.map((r) => [r.date, r]));
  const anaMap = new Map(anaQ.rows.map((r) => [r.date, r]));
  return bd.enumerateBuckets('day', start, end).map((date) => {
    const p = posMap.get(date);
    const a = anaMap.get(date);
    return {
      business_date: date,
      is_open: a ? a.is_open : null,
      weather: a ? a.weather : null,
      temperature_c: a ? a.temperature_c : null,
      note: a ? a.note : null,
      tags: a ? a.tags : [],
      revenue: p ? p.revenue : 0,
      order_count: p ? p.order_count : 0,
      guest_count: p ? p.guest_count : 0,
    };
  });
}

// 月の全日（未来日含む）を返す
async function fetchMonthDays(month, B) {
  const { start, end } = bd.monthRange(month);
  const days = await fetchDaysRange(start, end, B);
  return { month, start, end, days };
}

// ---- エンドポイント ----

// GET /api/v1/business-days?month=YYYY-MM
router.get('/', async (req, res, next) => {
  try {
    const { dayMode, boundaryHour, B } = await sales.resolveModeBoundary(req.query);
    const month = req.query.month !== undefined
      ? String(req.query.month)
      : bd.dateOf(dayMode, new Date(), boundaryHour).slice(0, 7);
    const data = await fetchMonthDays(month, B);
    res.json(await withMeta(data, { day_mode: dayMode, boundary_hour: boundaryHour, note: DAYS_NOTE }));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/business-days/:date { is_open, weather, temperature_c, note, tag_ids: [] }
// business_days upsert + business_day_tags 全置換を1トランザクションで行い、更新後の当日行を返す
router.put('/:date', async (req, res, next) => {
  try {
    const date = bd.assertYmd(req.params.date, 'date');
    const { dayMode, boundaryHour, B } = await sales.resolveModeBoundary(req.query);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const isOpen = parseIsOpen(body.is_open);
    const weather = parseWeather(body.weather);
    const temperature = parseTemperature(body.temperature_c);
    const note = parseNote(body.note);
    const tagIds = parseTagIds(body.tag_ids);

    if (tagIds.length > 0) {
      const { rows } = await ana.query('SELECT id FROM tags WHERE id = ANY($1::int[])', [tagIds]);
      const known = new Set(rows.map((r) => r.id));
      const missing = tagIds.filter((id) => !known.has(id));
      if (missing.length > 0) throw badRequest(`存在しない tag_id が含まれています: ${missing.join(', ')}`);
    }

    const client = await ana.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO business_days (business_date, is_open, weather, temperature_c, note, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (business_date) DO UPDATE
           SET is_open = EXCLUDED.is_open, weather = EXCLUDED.weather,
               temperature_c = EXCLUDED.temperature_c, note = EXCLUDED.note, updated_at = NOW()`,
        [date, isOpen, weather, temperature, note]
      );
      await client.query('DELETE FROM business_day_tags WHERE business_date = $1', [date]);
      for (const tagId of tagIds) {
        await client.query('INSERT INTO business_day_tags (business_date, tag_id) VALUES ($1, $2)', [date, tagId]);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    const days = await fetchDaysRange(date, date, B);
    res.json(await withMeta({ day: days[0] }, { day_mode: dayMode, boundary_hour: boundaryHour }));
  } catch (err) {
    next(err);
  }
});

module.exports = router;

// CSV 出力(routes/export.js)から同一定義を再利用するための追加 export（sales.js と同じ流儀）
module.exports.fetchDaysRange = fetchDaysRange;
module.exports.fetchMonthDays = fetchMonthDays;
