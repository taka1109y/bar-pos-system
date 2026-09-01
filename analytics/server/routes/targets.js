'use strict';
// /api/v1/targets — 目標の管理と進捗（Phase 3）
// - 目標本体（targets）は analyticsdb（ana.query = CRUD 可）。UNIQUE (period_type, period_start, metric) へ upsert
// - 進捗(/progress)の実績は routes/sales.js の fetchSummaryData を再利用する（営業日基準の月実績。
//   revenue/gross_profit/guest_count/order_count とも売上サマリと同定義）
// - period_type は 'month' / 'day'、metric は revenue / gross_profit / guest_count / order_count のみ受け付ける
//   （0001_init の CHECK はより広いが、API はこの範囲に限定する）
// - CSV 出力(routes/export.js)から再利用できるよう、fetch 群を末尾で追加 export する
const express = require('express');
const ana = require('../db/ana');
const posDefs = require('../lib/posDefs');
const bd = require('../lib/businessDay');
const { withMeta } = require('../lib/withMeta');
const sales = require('./sales');

const router = express.Router();

const { rate } = posDefs;

const METRICS = ['revenue', 'gross_profit', 'guest_count', 'order_count'];
const METRIC_LABELS = { revenue: '売上', gross_profit: '粗利', guest_count: '客数', order_count: '会計件数' };
const PERIOD_TYPES = ['month', 'day'];

const TARGET_COLUMNS = `period_type, period_start::text AS period_start, metric, value::float AS value`;
const MAX_VALUE = 1e9;

const PROGRESS_NOTE =
  '実績は営業日基準の月集計（売上サマリと同定義）。経過日数は月初〜今日（今日含む）の暦日数、' +
  '着地予測 = 実績 ÷ 経過日数 × 月日数（月末経過後は実績そのまま）、残り日割 = (目標 − 実績) ÷ 残暦日';

function badRequest(error) {
  return { status: 400, error };
}

function round1(v) {
  return Math.round(v * 10) / 10;
}

// ---- 入力検証（不正なら {status, error} を throw する既存流儀）----

function parsePeriodType(v) {
  if (!PERIOD_TYPES.includes(v)) throw badRequest(`period_type は ${PERIOD_TYPES.join(' / ')} のいずれかを指定してください`);
  return v;
}

function parseMetric(v) {
  if (!METRICS.includes(v)) throw badRequest(`metric は ${METRICS.join(' / ')} のいずれかを指定してください`);
  return v;
}

function parseValue(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > MAX_VALUE) throw badRequest(`value は 0〜${MAX_VALUE} の数値を指定してください`);
  return n;
}

// period_type='month' の period_start は月初日固定
function parsePeriodStart(periodType, v) {
  const ymd = bd.assertYmd(v, 'period_start');
  if (periodType === 'month' && ymd.slice(8) !== '01') {
    throw badRequest("period_type='month' の period_start は月初日(YYYY-MM-01)を指定してください");
  }
  return ymd;
}

// ---- fetch 群 ----

// 月次進捗。actual は営業日基準の月実績（sales.fetchSummaryData を再利用）
async function fetchProgressData(month, B, today) {
  const { start, end } = bd.monthRange(month);
  const monthDays = bd.diffDays(start, end) + 1;
  const elapsed = Math.max(0, Math.min(bd.diffDays(start, today) + 1, monthDays));
  const remaining = monthDays - elapsed;

  const [summary, targetsQ] = await Promise.all([
    sales.fetchSummaryData(start, end, B),
    ana.query(
      `SELECT metric, value::float AS value FROM targets
       WHERE period_type = 'month' AND period_start = $1 AND metric = ANY($2::text[])`,
      [start, METRICS]
    ),
  ]);
  const targetMap = new Map(targetsQ.rows.map((r) => [r.metric, r.value]));
  const actuals = {
    revenue: summary.total_revenue,
    gross_profit: summary.gross_profit,
    guest_count: summary.guest_count,
    order_count: summary.order_count,
  };
  const rows = METRICS.map((metric) => {
    const target = targetMap.has(metric) ? targetMap.get(metric) : null;
    const actual = actuals[metric];
    return {
      metric,
      label: METRIC_LABELS[metric],
      target,
      actual,
      achievement_pct: target > 0 ? rate(actual, target) : null,
      elapsed_days: elapsed,
      month_days: monthDays,
      forecast: elapsed >= monthDays ? actual : (elapsed > 0 ? Math.round((actual / elapsed) * monthDays) : null),
      required_per_remaining_day: target != null && remaining > 0 ? round1((target - actual) / remaining) : null,
    };
  });
  return { month, start, end, rows };
}

// ---- エンドポイント ----

// GET /api/v1/targets?year=YYYY(会計年度。省略時は今年度)&metric=(省略時は全部)
router.get('/', async (req, res, next) => {
  try {
    const { settings, dayMode, boundaryHour } = await sales.resolveModeBoundary(req.query);
    const metric = req.query.metric !== undefined ? parseMetric(String(req.query.metric)) : null;
    const fyMonth = settings.fiscal_year_start_month;
    let year;
    if (req.query.year !== undefined) {
      year = Number(req.query.year);
      if (!Number.isInteger(year) || year < 2000 || year > 2100) {
        throw badRequest('year は 2000〜2100 の整数を指定してください');
      }
    } else {
      const today = bd.dateOf(dayMode, new Date(), boundaryHour);
      year = Number(bd.bucketStartOf('fiscal_year', today, { fiscalYearStartMonth: fyMonth }).slice(0, 4));
    }
    const start = `${year}-${String(fyMonth).padStart(2, '0')}-01`;
    const endExclusive = bd.addYears(start, 1);
    const params = [start, endExclusive];
    let metricFilter = '';
    if (metric) {
      params.push(metric);
      metricFilter = ` AND metric = $${params.length}`;
    }
    const { rows } = await ana.query(
      `SELECT ${TARGET_COLUMNS} FROM targets
       WHERE period_type IN ('month', 'day') AND period_start >= $1 AND period_start < $2${metricFilter}
       ORDER BY period_start, metric`,
      params
    );
    res.json(await withMeta({ year, fiscal_year_start: start, rows }));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/targets/progress?month=YYYY-MM&day_mode=
router.get('/progress', async (req, res, next) => {
  try {
    const { dayMode, boundaryHour, B } = await sales.resolveModeBoundary(req.query);
    const today = bd.dateOf(dayMode, new Date(), boundaryHour);
    const month = req.query.month !== undefined ? String(req.query.month) : today.slice(0, 7);
    const data = await fetchProgressData(month, B, today);
    res.json(await withMeta(data, { day_mode: dayMode, boundary_hour: boundaryHour, note: PROGRESS_NOTE }));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/targets { period_type, period_start, metric, value } — upsert
router.put('/', async (req, res, next) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const periodType = parsePeriodType(body.period_type);
    const periodStart = parsePeriodStart(periodType, body.period_start);
    const metric = parseMetric(body.metric);
    const value = parseValue(body.value);
    const { rows: [row] } = await ana.query(
      `INSERT INTO targets (period_type, period_start, metric, value)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (period_type, period_start, metric) DO UPDATE SET value = EXCLUDED.value
       RETURNING ${TARGET_COLUMNS}`,
      [periodType, periodStart, metric, value]
    );
    res.json(await withMeta({ target: row }));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/targets?period_type=&period_start=&metric=
router.delete('/', async (req, res, next) => {
  try {
    const periodType = parsePeriodType(String(req.query.period_type || ''));
    const periodStart = parsePeriodStart(periodType, req.query.period_start);
    const metric = parseMetric(String(req.query.metric || ''));
    const { rows: [row] } = await ana.query(
      `DELETE FROM targets WHERE period_type = $1 AND period_start = $2 AND metric = $3
       RETURNING ${TARGET_COLUMNS}`,
      [periodType, periodStart, metric]
    );
    if (!row) {
      return res.status(404).json({ error: `目標が見つかりません: ${periodType} ${periodStart} ${metric}` });
    }
    res.json(await withMeta({ deleted: true, target: row }));
  } catch (err) {
    next(err);
  }
});

module.exports = router;

// CSV 出力(routes/export.js)から同一定義を再利用するための追加 export（sales.js と同じ流儀）
module.exports.fetchProgressData = fetchProgressData;
module.exports.METRICS = METRICS;
module.exports.METRIC_LABELS = METRIC_LABELS;
