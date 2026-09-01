'use strict';
// /api/v1/seats — 客席分析 API（Phase 3）
// - bardb へは pos.query（WITH/SELECT/EXPLAIN ガード付き）のみ。プレースホルダ順は [start, end, TZ, B] を厳守
//   （追加パラメータは $5 以降に付ける）
// - 共通クエリ（start/end/day_mode/boundary_hour）の解決は routes/sales.js の resolveContext を再利用する
// - 滞在時間・稼働は既存定義どおり即会計テーブル(table_type='immediate')を除外し closed_at > opened_at のみ集計する
// - 席数は analyticsdb の seat_capacities を JS で結合する（未設定は seats=null）
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
const RANGE_W = bd.rangeWhereParam('o.closed_at'); // sargable な期間フィルタ（会計日基準）
const DATE_B = bd.dateExprParam('o.closed_at');    // 営業日/暦日（B=0 で暦日）

// 滞在時間の対象（既存の平均滞在と同定義: 即会計除外・closed>opened のみ）
const STAY_FROM = `FROM orders o
       JOIN tables t ON o.table_id = t.id
       WHERE ${PAID_FILTER} AND ${RANGE_W}
         AND o.closed_at > o.opened_at AND t.table_type <> 'immediate'`;

const STAY_CAP_MINUTES = 720; // 滞在分布の上限（12時間。超過は最終バケットに「以上」として集約）
const PER_GUEST_BIN = 500;    // 客単価分布の刻み（円）
const PER_GUEST_CAP = 20000;  // 客単価分布の上限（超過は最終バケットに「以上」として集約）

const UTILIZATION_NOTE =
  '稼働率 = 客数 ÷ (席数 × 営業日数)。席数未設定(seats=null)と即会計テーブルは計算対象外で、100%超もそのまま返します。' +
  '営業日数(open_days)は期間内に会計が1件以上ある営業日数';
const TIMELINE_NOTE = 'paid の会計のみ・即会計テーブル除外。hour32 は分を小数化した32時間表記（例 26.5 = 翌2:30）';
const STAY_NOTE = '滞在時間は即会計テーブルを除外し closed_at > opened_at の会計のみ（既存の平均滞在と同定義）';
const GUESTS_NOTE =
  '客単価分布は 会計金額 ÷ 人数（0人会計は除外）を500円刻みで集計。avg_party_size / avg_per_guest は売上サマリと同定義';

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

// 32時間表記の時（分は小数第1位。例 26.5 = 翌2:30）
function hour32Frac(ts, B) {
  const p = bd.localParts(new Date(ts));
  const h = p.hour < B ? p.hour + 24 : p.hour;
  return Math.round((h + p.minute / 60) * 10) / 10;
}

// bin_minutes（滞在分布の刻み。既定15分・5〜120）
function parseBinMinutes(q) {
  if (q.bin_minutes === undefined) return 15;
  const n = Number(q.bin_minutes);
  if (!Number.isInteger(n) || n < 5 || n > 120) throw badRequest('bin_minutes は 5〜120 の整数を指定してください');
  return n;
}

// ---- fetch 群（SQL は [start, end, TZ, B] ＋追加パラメータで実行する）----

// 卓別の稼働・回転。rows は bardb.tables 全件（実績なしは0行埋め）、seats は seat_capacities を JS 結合。
// totals は orders 直接集計（tables 結合に依存させず保存則を保つ）
async function fetchUtilizationData(start, end, B) {
  const params = [start, end, bd.TZ, B];
  const [tablesQ, globalQ, capsQ] = await Promise.all([
    pos.query(
      `WITH agg AS (
         SELECT o.table_id,
                COUNT(*)::int AS order_count,
                COALESCE(SUM(o.guest_count), 0)::int AS guest_count,
                COALESCE(SUM(o.total_amount), 0)::float AS revenue,
                (AVG(EXTRACT(EPOCH FROM (o.closed_at - o.opened_at)) / 60)
                  FILTER (WHERE o.closed_at > o.opened_at))::float AS avg_stay_minutes
         FROM orders o
         WHERE ${PAID_FILTER} AND ${RANGE_W}
         GROUP BY o.table_id
       )
       SELECT t.id AS table_id, t.name AS table_name, t.table_type, t.is_active,
              COALESCE(a.order_count, 0)::int AS order_count,
              COALESCE(a.guest_count, 0)::int AS guest_count,
              COALESCE(a.revenue, 0)::float AS revenue,
              a.avg_stay_minutes
       FROM tables t
       LEFT JOIN agg a ON a.table_id = t.id
       ORDER BY t.id`,
      params
    ),
    pos.query(
      `SELECT COUNT(DISTINCT ${DATE_B})::int AS open_days,
              COUNT(*)::int AS order_count,
              COALESCE(SUM(o.guest_count), 0)::int AS guest_count,
              COALESCE(SUM(o.total_amount), 0)::float AS revenue
       FROM orders o
       WHERE ${PAID_FILTER} AND ${RANGE_W}`,
      params
    ),
    ana.query('SELECT table_id, seats, include_in_utilization FROM seat_capacities'),
  ]);
  const capMap = new Map(capsQ.rows.map((r) => [r.table_id, r]));
  const g = globalQ.rows[0];
  const openDays = g.open_days;
  const rows = tablesQ.rows.map((t) => {
    const cap = capMap.get(t.table_id);
    const seats = cap ? cap.seats : null;
    const isImmediate = t.table_type === 'immediate';
    return {
      table_id: t.table_id,
      table_name: t.table_name,
      table_type: t.table_type,
      is_active: t.is_active,
      seats,
      include_in_utilization: cap ? cap.include_in_utilization : null,
      order_count: t.order_count,
      guest_count: t.guest_count,
      revenue: t.revenue,
      // 滞在・稼働は即会計を除外（既存定義）。100超も実値のまま返し UI 側で警告する
      avg_stay_minutes: !isImmediate && t.avg_stay_minutes != null ? Math.round(t.avg_stay_minutes) : null,
      turnover_per_open_day: openDays > 0 ? round1(t.order_count / openDays) : null,
      seat_utilization_pct: !isImmediate && seats > 0 && openDays > 0
        ? round1((t.guest_count / (seats * openDays)) * 100)
        : null,
    };
  });
  return {
    open_days: openDays,
    rows,
    totals: { order_count: g.order_count, guest_count: g.guest_count, revenue: g.revenue },
  };
}

// 1営業日分の卓別タイムライン（ガント用の区間リスト）。paid のみ・即会計除外
async function fetchTimelineIntervals(date, B) {
  const params = [date, date, bd.TZ, B];
  const { rows } = await pos.query(
    `SELECT o.table_id, t.name AS table_name, o.id AS order_id,
            o.opened_at, o.closed_at,
            COALESCE(o.guest_count, 0)::int AS guest_count,
            COALESCE(o.total_amount, 0)::float AS total_amount
     FROM orders o
     JOIN tables t ON o.table_id = t.id
     WHERE ${PAID_FILTER} AND ${RANGE_W} AND t.table_type <> 'immediate'
     ORDER BY o.table_id, o.opened_at, o.id`,
    params
  );
  return rows.map((r) => ({
    table_id: r.table_id,
    table_name: r.table_name,
    order_id: r.order_id,
    opened_at: r.opened_at,
    closed_at: r.closed_at,
    opened_hour32: r.opened_at ? hour32Frac(r.opened_at, B) : null,
    closed_hour32: r.closed_at ? hour32Frac(r.closed_at, B) : null,
    guest_count: r.guest_count,
    total_amount: r.total_amount,
  }));
}

// 滞在時間の分布。buckets は bin_minutes 刻みで 0埋め（上限超過は最終バケット max_minutes=null に集約）
async function fetchStayDistribution(start, end, B, binMinutes) {
  const capIdx = Math.floor(STAY_CAP_MINUTES / binMinutes);
  const params = [start, end, bd.TZ, B];
  const staysCte = `stays AS (
       SELECT EXTRACT(EPOCH FROM (o.closed_at - o.opened_at)) / 60.0 AS stay
       ${STAY_FROM}
     )`;
  const [statsQ, bucketsQ] = await Promise.all([
    pos.query(
      `WITH ${staysCte}
       SELECT COUNT(*)::int AS count,
              COALESCE(AVG(stay), 0)::float AS avg_minutes,
              percentile_cont(ARRAY[0.25, 0.5, 0.75, 0.9]) WITHIN GROUP (ORDER BY stay) AS pct
       FROM stays`,
      params
    ),
    pos.query(
      `WITH ${staysCte}
       SELECT LEAST(FLOOR(stay / $5)::int, $6::int) AS bucket, COUNT(*)::int AS count
       FROM stays
       GROUP BY 1
       ORDER BY 1`,
      [...params, binMinutes, capIdx]
    ),
  ]);
  const s = statsQ.rows[0];
  const pct = s.pct || [];
  const bucketMap = new Map(bucketsQ.rows.map((r) => [r.bucket, r.count]));
  const maxIdx = bucketsQ.rows.length > 0 ? bucketsQ.rows[bucketsQ.rows.length - 1].bucket : -1;
  const buckets = [];
  for (let i = 0; i <= maxIdx; i++) {
    buckets.push({
      min_minutes: i * binMinutes,
      max_minutes: i >= capIdx ? null : (i + 1) * binMinutes, // null = 上限超過の「以上」バケット
      count: bucketMap.get(i) || 0,
    });
  }
  return {
    bin_minutes: binMinutes,
    count: s.count,
    avg_minutes: round1(s.avg_minutes),
    percentiles: {
      p25: pct[0] != null ? round1(pct[0]) : null,
      p50: pct[1] != null ? round1(pct[1]) : null,
      p75: pct[2] != null ? round1(pct[2]) : null,
      p90: pct[3] != null ? round1(pct[3]) : null,
    },
    buckets,
  };
}

// 客数・客単価。party_size は組人数（guest_count）別、per_guest_bins は客単価500円刻み（guest>0 のみ）
async function fetchGuestsData(start, end, B) {
  const params = [start, end, bd.TZ, B];
  const capIdx = Math.floor(PER_GUEST_CAP / PER_GUEST_BIN);
  const [sumQ, partyQ, binsQ] = await Promise.all([
    pos.query(
      `SELECT COUNT(*)::int AS order_count,
              COALESCE(SUM(o.guest_count), 0)::int AS guest_count,
              COALESCE(SUM(o.total_amount), 0)::float AS revenue
       FROM orders o
       WHERE ${PAID_FILTER} AND ${RANGE_W}`,
      params
    ),
    pos.query(
      `SELECT o.guest_count::int AS guest_count,
              COUNT(*)::int AS order_count,
              COALESCE(SUM(o.total_amount), 0)::float AS revenue
       FROM orders o
       WHERE ${PAID_FILTER} AND ${RANGE_W}
       GROUP BY 1
       ORDER BY 1`,
      params
    ),
    pos.query(
      `SELECT LEAST(FLOOR((o.total_amount::float / o.guest_count) / $5)::int, $6::int) AS bin,
              COUNT(*)::int AS count
       FROM orders o
       WHERE ${PAID_FILTER} AND ${RANGE_W} AND o.guest_count > 0
       GROUP BY 1
       ORDER BY 1`,
      [...params, PER_GUEST_BIN, capIdx]
    ),
  ]);
  const s = sumQ.rows[0];
  const binMap = new Map(binsQ.rows.map((r) => [r.bin, r.count]));
  const maxIdx = binsQ.rows.length > 0 ? binsQ.rows[binsQ.rows.length - 1].bin : -1;
  const perGuestBins = [];
  for (let i = 0; i <= maxIdx; i++) {
    perGuestBins.push({
      min: i * PER_GUEST_BIN,
      max: i >= capIdx ? null : (i + 1) * PER_GUEST_BIN, // null = 上限超過の「以上」バケット
      count: binMap.get(i) || 0,
    });
  }
  return {
    summary: {
      // sales.fetchSummaryData の avg_guests_per_order / avg_per_guest と同定義
      avg_party_size: s.order_count > 0 ? round1(s.guest_count / s.order_count) : 0,
      avg_per_guest: s.guest_count > 0 ? Math.round(s.revenue / s.guest_count) : 0,
    },
    party_size: partyQ.rows,
    per_guest_bins: perGuestBins,
  };
}

// ---- エンドポイント ----

// GET /api/v1/seats/utilization
router.get('/utilization', async (req, res, next) => {
  try {
    const ctx = await sales.resolveContext(req.query);
    const data = await fetchUtilizationData(ctx.start, ctx.end, ctx.B);
    res.json(await withMeta({ start: ctx.start, end: ctx.end, ...data }, metaExtra(ctx, UTILIZATION_NOTE)));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/seats/timeline?date=YYYY-MM-DD（営業日。省略時は今日）
router.get('/timeline', async (req, res, next) => {
  try {
    const { dayMode, boundaryHour, B } = await sales.resolveModeBoundary(req.query);
    const date = req.query.date !== undefined
      ? bd.assertYmd(req.query.date, 'date')
      : bd.dateOf(dayMode, new Date(), boundaryHour);
    const intervals = await fetchTimelineIntervals(date, B);
    res.json(await withMeta({ date, intervals },
      { day_mode: dayMode, boundary_hour: boundaryHour, note: TIMELINE_NOTE }));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/seats/stay-distribution?bin_minutes=15
router.get('/stay-distribution', async (req, res, next) => {
  try {
    const ctx = await sales.resolveContext(req.query);
    const binMinutes = parseBinMinutes(req.query);
    const data = await fetchStayDistribution(ctx.start, ctx.end, ctx.B, binMinutes);
    res.json(await withMeta({ start: ctx.start, end: ctx.end, ...data }, metaExtra(ctx, STAY_NOTE)));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/seats/guests
router.get('/guests', async (req, res, next) => {
  try {
    const ctx = await sales.resolveContext(req.query);
    const data = await fetchGuestsData(ctx.start, ctx.end, ctx.B);
    res.json(await withMeta({ start: ctx.start, end: ctx.end, ...data }, metaExtra(ctx, GUESTS_NOTE)));
  } catch (err) {
    next(err);
  }
});

module.exports = router;

// CSV 出力(routes/export.js)から同一定義を再利用するための追加 export（sales.js と同じ流儀）
module.exports.parseBinMinutes = parseBinMinutes;
module.exports.fetchUtilizationData = fetchUtilizationData;
module.exports.fetchTimelineIntervals = fetchTimelineIntervals;
module.exports.fetchStayDistribution = fetchStayDistribution;
module.exports.fetchGuestsData = fetchGuestsData;
