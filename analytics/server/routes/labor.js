'use strict';
// /api/v1/labor — 人時生産性（Phase 4）
// - 売上・粗利は routes/sales.js の fetch 群（= posDefs と同一定義）を再利用する
// - 労働時間・人件費は analyticsdb の shifts（routes/staff.js の fetch 群）。
//   store_settings.include_owner_labor=false なら employment_type='owner' を除外する（pl.js と同じ規則）
// - by_hour32 の staff_hours は各シフトの在店時間（start_at〜end_at。休憩は差し引かない）を
//   1時間単位で hour32 バケットへ按分する（部分時間は分数で加算）。revenue は sales/hourly と同じ明細ベース
const express = require('express');
const posDefs = require('../lib/posDefs');
const bd = require('../lib/businessDay');
const { withMeta } = require('../lib/withMeta');
const sales = require('./sales');
const staff = require('./staff');

const router = express.Router();

const { rate } = posDefs;

const PRODUCTIVITY_NOTE =
  '労働時間 = シフトの実働分（休憩控除後）の合計。人時売上 = 売上 ÷ 労働時間、人時粗利 = 粗利 ÷ 労働時間' +
  '（labor_hours=0 の行は null）。include_owner_labor=false ならオーナーのシフトを除外。' +
  'by_hour32 の staff_hours は在店時間（休憩を差し引かない）を1時間単位で按分し、' +
  'revenue は order_items(明細)ベース（チャージ・深夜料金を含まない）';

// meta に付与する共通情報（sales.js の metaExtra と同じ形）
function metaExtra(ctx, note) {
  return { day_mode: ctx.dayMode, boundary_hour: ctx.boundaryHour, ...(note ? { note } : {}) };
}

function round1(v) {
  return Math.round(v * 10) / 10;
}

// 労働時間（分）→ 時間表記。0.1h 単位に丸める
function hoursOf(minutes) {
  return round1(minutes / 60);
}

// minutes（正確値）を分母に使う人時指標。労働 0 分なら null
function perHour(amount, minutes) {
  return minutes > 0 ? Math.round(amount / (minutes / 60)) : null;
}

// 各シフトの在店時間（start_at〜end_at）を hour32 バケットへ按分する。
// JST は UTC+9 の固定オフセットなので epoch の1時間境界がローカルの時境界と一致する
function spreadShiftHours(shiftRows, B, tz = bd.TZ) {
  const hours = new Map(); // hour32 → 時間（float）
  const HOUR_MS = 3600 * 1000;
  for (const s of shiftRows) {
    let t = new Date(s.start_at).getTime();
    const endMs = new Date(s.end_at).getTime();
    let guard = 0;
    while (t < endMs && guard < 48) {
      const nextBoundary = Math.floor(t / HOUR_MS) * HOUR_MS + HOUR_MS;
      const sliceEnd = Math.min(endMs, nextBoundary);
      const h = bd.localParts(new Date(t), tz).hour;
      const hour32 = h < B ? h + 24 : h;
      hours.set(hour32, (hours.get(hour32) || 0) + (sliceEnd - t) / HOUR_MS);
      t = sliceEnd;
      guard += 1;
    }
  }
  return hours;
}

// ---- fetch 群 ----

// 人時生産性（summary / by_period / by_staff / by_hour32）
async function fetchProductivityData(start, end, B, granularity, gopts = {}) {
  const settings = await staff.loadLaborSettings();
  const includeOwner = settings.include_owner_labor;
  const [summarySales, trend, hourly, laborDaily, byStaffRows, shiftRows] = await Promise.all([
    sales.fetchSummaryData(start, end, B),
    sales.fetchTrendRows(start, end, B, granularity, gopts),
    sales.fetchHourlyRows(start, end, B),
    staff.fetchLaborDaily(start, end, includeOwner),
    staff.fetchLaborByStaff(start, end, includeOwner),
    staff.fetchShiftRows(start, end),
  ]);

  // summary
  const totalMinutes = laborDaily.reduce((acc, r) => acc + r.work_minutes, 0);
  const totalLaborCost = Math.round(laborDaily.reduce((acc, r) => acc + r.labor_cost, 0));
  const summary = {
    labor_hours: hoursOf(totalMinutes),
    labor_cost: totalLaborCost,
    revenue: summarySales.total_revenue,
    gross_profit: summarySales.gross_profit,
    sales_per_labor_hour: perHour(summarySales.total_revenue, totalMinutes),
    gross_profit_per_labor_hour: perHour(summarySales.gross_profit, totalMinutes),
    labor_cost_rate: rate(totalLaborCost, summarySales.total_revenue),
  };

  // by_period（売上トレンドと同じ0埋めバケットに労働時間・人件費を重ねる）
  const laborByBucket = new Map();
  for (const r of laborDaily) {
    const bucket = bd.bucketStartOf(granularity, r.business_date, gopts);
    if (!laborByBucket.has(bucket)) laborByBucket.set(bucket, { minutes: 0, cost: 0 });
    const b = laborByBucket.get(bucket);
    b.minutes += r.work_minutes;
    b.cost += r.labor_cost;
  }
  const byPeriod = trend.map((p) => {
    const b = laborByBucket.get(p.period_start) || { minutes: 0, cost: 0 };
    const cost = Math.round(b.cost);
    return {
      period_start: p.period_start,
      label: p.label,
      labor_hours: hoursOf(b.minutes),
      labor_cost: cost,
      revenue: p.revenue,
      sales_per_labor_hour: perHour(p.revenue, b.minutes),
      labor_cost_rate: rate(cost, p.revenue),
    };
  });

  // by_staff
  const byStaff = byStaffRows.map((r) => ({
    staff_id: r.staff_id,
    name: r.name,
    labor_hours: hoursOf(r.work_minutes),
    labor_cost: Math.round(r.labor_cost),
    shift_count: r.shift_count,
  }));

  // by_hour32（B..B+23 の24行固定。sales/hourly と同じ軸）
  const targetShifts = includeOwner ? shiftRows : shiftRows.filter((s) => s.employment_type !== 'owner');
  const staffHoursMap = spreadShiftHours(targetShifts, B);
  const byHour32 = hourly.map((h) => {
    const sh = staffHoursMap.get(h.hour32) || 0;
    return {
      hour32: h.hour32,
      label: h.label,
      staff_hours: round1(sh),
      revenue: h.revenue,
      sales_per_labor_hour: sh > 0 ? Math.round(h.revenue / sh) : null,
    };
  });

  return { summary, by_period: byPeriod, by_staff: byStaff, by_hour32: byHour32 };
}

// ---- エンドポイント ----

// GET /api/v1/labor/productivity?start&end&day_mode&granularity
router.get('/productivity', async (req, res, next) => {
  try {
    const ctx = await sales.resolveContext(req.query);
    const data = await fetchProductivityData(ctx.start, ctx.end, ctx.B, ctx.granularity, ctx.gopts);
    res.json(await withMeta(
      { start: ctx.start, end: ctx.end, granularity: ctx.granularity, ...data },
      metaExtra(ctx, PRODUCTIVITY_NOTE)
    ));
  } catch (err) {
    next(err);
  }
});

module.exports = router;

// CSV 出力(routes/export.js)から同一定義を再利用するための追加 export（sales.js と同じ流儀）
module.exports.fetchProductivityData = fetchProductivityData;
