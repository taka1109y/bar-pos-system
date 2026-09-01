'use strict';
// /api/v1/pl — 月次P&L（/statement）と損益分岐点（/breakeven）（Phase 4）
// - 売上・原価(レシピ)・粗利は routes/sales.js の fetch 群（= posDefs と同一定義）を再利用する。
//   bardb へは pos.query（SELECT のみ）。プレースホルダ順は [start, end, TZ, B] を厳守
// - 人件費（labor_shift）は analyticsdb の shifts（routes/staff.js の fetch 群）、
//   経費は expenses × expense_categories（pnl_line / cost_type）で集計する
// - 経費の按分: alloc_method='date' はその日付が期間内なら全額、'month_even' は
//   月内の営業日数（会計が1件以上ある営業日）で日割りし、期間に含まれる営業日分だけ計上する。
//   営業日が1日も無い月は暦日で日割りする（家賃だけ先に入力した月が0円になるのを防ぐ）
// - 営業利益 = 粗利 −（人件費計 + 仕入・人件費以外の経費）。仕入(purchase)はレシピ原価と
//   二重控除になるため営業利益に含めない（参考行 alt_purchase_based_profit で実仕入ベースを併記）
// - CSV 出力(routes/export.js)から再利用できるよう、fetch 群を末尾で追加 export する
const express = require('express');
const pos = require('../db/pos');
const ana = require('../db/ana');
const posDefs = require('../lib/posDefs');
const bd = require('../lib/businessDay');
const { withMeta } = require('../lib/withMeta');
const sales = require('./sales');
const staff = require('./staff');
const expenses = require('./expenses');

const router = express.Router();

const { PAID_FILTER, rate } = posDefs;
const { PNL_LINES } = expenses;

// パラメータ化 SQL 断片（$1=start, $2=end, $3=TZ, $4=B。sales.js と同じ式）
const RANGE_W = bd.rangeWhereParam('o.closed_at');
const DATE_B = bd.dateExprParam('o.closed_at');

// 仕入・人件費以外の経費行（営業利益の控除対象）
const EXPENSE_LINES = PNL_LINES.filter((l) => l !== 'purchase' && l !== 'labor');

const PL_GRANULARITIES = ['month', 'fiscal_year'];

const STATEMENT_NOTE =
  '売上・原価(レシピ)・粗利は売上分析と同一定義。labor_shift=シフト人件費(実働分×時給スナップショット。' +
  'include_owner_labor=false ならオーナー除外)、labor_other=経費のPL行「labor」。' +
  '営業利益 = 粗利 −（人件費計 + 仕入・人件費以外の経費）。仕入(purchase)はレシピ原価との二重控除を避けるため' +
  '営業利益に含めない（参考行 alt_purchase_based_profit = 売上 − 実仕入 − 人件費計 − 経費）。' +
  "month_even 経費は月内の営業日数で日割りし期間内の営業日分のみ計上（営業日0の月は暦日で日割り）。" +
  'FLコスト = 原価(レシピ) + 人件費計';

const BREAKEVEN_NOTE =
  '固定費 = cost_type=fixed の経費（仕入・人件費行を除く）+（labor_is_fixed_for_bep=true なら人件費計）。' +
  '変動費 = 原価(レシピ) + cost_type=variable の経費（仕入・人件費行を除く）+（labor_is_fixed_for_bep=false なら人件費計）。' +
  '仕入(purchase)は原価と二重になるため除外。人件費計（labor_shift+labor_other）は二重計上を避けるため' +
  'cost_type ではなく labor_is_fixed_for_bep でどちらか片方に入れる。' +
  'BEP売上 = 固定費 ÷ (1 − 変動費率)。remaining_open_days_est = 残暦日 × (経過営業日 ÷ 経過暦日) の概算';

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

// P&L の粒度（month / fiscal_year のみ。既定 month）
function parsePlGranularity(v) {
  if (v === undefined) return 'month';
  if (!PL_GRANULARITIES.includes(v)) {
    throw badRequest(`granularity は ${PL_GRANULARITIES.join(' / ')} のいずれかを指定してください`);
  }
  return v;
}

// ---- 経費の按分集計 ----

// 期間 [start, end] の経費をバケット別 × pnl_line × cost_type に按分して集計する。
// 戻り値: Map(bucket → Map("pnl_line|cost_type" → 金額float))
// - 'date': expense_date が期間内なら全額。バケットは expense_date の属するバケット
// - 'month_even': その月の営業日数で日割りし、期間内の営業日分だけ計上。
//   月は必ず単一バケットに収まる（粒度は month / fiscal_year で、年度境界は月初）
// - pnl_line が NULL の科目は 'other'、cost_type が NULL の科目は 'variable' として扱う
async function fetchExpenseAllocation(start, end, B, granularity, gopts = {}) {
  const monthStart = `${start.slice(0, 7)}-01`;
  const monthEnd = bd.monthRange(end.slice(0, 7)).end;
  const [expQ, openQ] = await Promise.all([
    ana.query(
      `SELECT e.expense_date::text AS expense_date, e.amount::float AS amount, e.alloc_method,
              COALESCE(c.pnl_line, 'other') AS pnl_line, COALESCE(c.cost_type, 'variable') AS cost_type
       FROM expenses e
       JOIN expense_categories c ON c.id = e.category_id
       WHERE (e.alloc_method = 'date' AND e.expense_date BETWEEN $1 AND $2)
          OR (e.alloc_method = 'month_even' AND e.expense_date BETWEEN $3 AND $4)`,
      [start, end, monthStart, monthEnd]
    ),
    // 営業日（会計が1件以上ある営業日）。month_even の日割り分母に月全体が要るため月初〜月末で引く
    pos.query(
      `SELECT ${DATE_B}::text AS date
       FROM orders o
       WHERE ${PAID_FILTER} AND ${RANGE_W}
       GROUP BY 1`,
      [monthStart, monthEnd, bd.TZ, B]
    ),
  ]);

  // 月別の営業日数（total = 月全体、in_range = [start, end] 内）
  const openByMonth = new Map();
  for (const r of openQ.rows) {
    const m = r.date.slice(0, 7);
    if (!openByMonth.has(m)) openByMonth.set(m, { total: 0, in_range: 0 });
    const o = openByMonth.get(m);
    o.total += 1;
    if (r.date >= start && r.date <= end) o.in_range += 1;
  }

  const acc = new Map();
  const add = (bucket, line, costType, amount) => {
    if (amount === 0) return;
    if (!acc.has(bucket)) acc.set(bucket, new Map());
    const m = acc.get(bucket);
    const key = `${line}|${costType}`;
    m.set(key, (m.get(key) || 0) + amount);
  };

  for (const e of expQ.rows) {
    if (e.alloc_method === 'month_even') {
      const month = e.expense_date.slice(0, 7);
      const mStart = `${month}-01`;
      const mEnd = bd.monthRange(month).end;
      const bucket = bd.bucketStartOf(granularity, mStart, gopts);
      const open = openByMonth.get(month);
      let ratio;
      if (open && open.total > 0) {
        ratio = open.in_range / open.total;
      } else {
        // 営業日が1日も無い月は暦日で日割り（期間と月の重なり日数 ÷ 月日数）
        const overlapStart = start > mStart ? start : mStart;
        const overlapEnd = end < mEnd ? end : mEnd;
        const overlapDays = overlapStart <= overlapEnd ? bd.diffDays(overlapStart, overlapEnd) + 1 : 0;
        ratio = overlapDays / (bd.diffDays(mStart, mEnd) + 1);
      }
      add(bucket, e.pnl_line, e.cost_type, e.amount * ratio);
    } else {
      add(bd.bucketStartOf(granularity, e.expense_date, gopts), e.pnl_line, e.cost_type, e.amount);
    }
  }
  return acc;
}

// バケット1つ分の Map("line|cost_type" → 金額) から行別合計（fixed+variable）を作る
function linesOf(bucketMap) {
  const out = {};
  for (const line of PNL_LINES) out[line] = 0;
  if (bucketMap) {
    for (const [key, amount] of bucketMap) {
      const line = key.split('|')[0];
      out[line] += amount;
    }
  }
  return out;
}

// ---- P&L 計算書 ----

// 期間 [start, end] の P&L（バケット別 rows + totals）。rows は fetchTrendRows と同じ0埋めバケット
async function fetchStatementData(start, end, B, granularity, gopts = {}) {
  const settings = await staff.loadLaborSettings();
  const [trend, laborDaily, alloc] = await Promise.all([
    sales.fetchTrendRows(start, end, B, granularity, gopts),
    staff.fetchLaborDaily(start, end, settings.include_owner_labor),
    fetchExpenseAllocation(start, end, B, granularity, gopts),
  ]);

  // シフト人件費をバケットへ集計（business_date の属するバケット）
  const laborByBucket = new Map();
  for (const r of laborDaily) {
    const bucket = bd.bucketStartOf(granularity, r.business_date, gopts);
    laborByBucket.set(bucket, (laborByBucket.get(bucket) || 0) + r.labor_cost);
  }

  const buildRow = (p) => {
    const lines = linesOf(alloc.get(p.period_start));
    const laborShift = Math.round(laborByBucket.get(p.period_start) || 0);
    const laborOther = Math.round(lines.labor);
    const laborTotal = laborShift + laborOther;
    const byLine = {};
    for (const line of PNL_LINES) byLine[line] = Math.round(lines[line]);
    const expensesExcl = EXPENSE_LINES.reduce((acc2, l) => acc2 + byLine[l], 0);
    const purchaseActual = byLine.purchase;
    const operatingProfit = p.gross_profit - laborTotal - expensesExcl;
    const flCost = p.total_cost + laborTotal;
    return {
      period_start: p.period_start,
      label: p.label,
      revenue: p.revenue,
      cogs_recipe: p.total_cost,
      gross_profit: p.gross_profit,
      gross_profit_rate: p.gross_profit_rate,
      labor_shift: laborShift,
      labor_other: laborOther,
      labor_total: laborTotal,
      labor_cost_rate: rate(laborTotal, p.revenue),
      expenses_by_line: byLine,
      expenses_total_excl_purchase_labor: expensesExcl,
      purchase_actual: purchaseActual,
      operating_profit: operatingProfit,
      operating_margin_pct: rate(operatingProfit, p.revenue),
      fl_cost: flCost,
      fl_ratio_pct: rate(flCost, p.revenue),
      alt_purchase_based_profit: p.revenue - purchaseActual - laborTotal - expensesExcl,
    };
  };

  const rows = trend.map(buildRow);

  // totals は rows の合計から作る（丸め後の値を合計するので表の縦計と一致する）
  const sum = (k) => rows.reduce((acc2, r) => acc2 + r[k], 0);
  const totalByLine = {};
  for (const line of PNL_LINES) {
    totalByLine[line] = rows.reduce((acc2, r) => acc2 + r.expenses_by_line[line], 0);
  }
  const revenue = sum('revenue');
  const laborTotal = sum('labor_total');
  const operatingProfit = sum('operating_profit');
  const flCost = sum('fl_cost');
  const grossProfit = sum('gross_profit');
  const totals = {
    period_start: null,
    label: '合計',
    revenue,
    cogs_recipe: sum('cogs_recipe'),
    gross_profit: grossProfit,
    gross_profit_rate: rate(grossProfit, revenue),
    labor_shift: sum('labor_shift'),
    labor_other: sum('labor_other'),
    labor_total: laborTotal,
    labor_cost_rate: rate(laborTotal, revenue),
    expenses_by_line: totalByLine,
    expenses_total_excl_purchase_labor: sum('expenses_total_excl_purchase_labor'),
    purchase_actual: sum('purchase_actual'),
    operating_profit: operatingProfit,
    operating_margin_pct: rate(operatingProfit, revenue),
    fl_cost: flCost,
    fl_ratio_pct: rate(flCost, revenue),
    alt_purchase_based_profit: sum('alt_purchase_based_profit'),
  };
  return { rows, totals };
}

// ---- 損益分岐点 ----

// month=YYYY-MM の損益分岐点。today はモード基準の今日（残営業日の概算用）
async function fetchBreakevenData(month, B, today) {
  const { start, end } = bd.monthRange(month);
  const settings = await staff.loadLaborSettings();
  const [summary, laborDaily, alloc] = await Promise.all([
    sales.fetchSummaryData(start, end, B),
    staff.fetchLaborDaily(start, end, settings.include_owner_labor),
    fetchExpenseAllocation(start, end, B, 'month'),
  ]);
  const laborShift = Math.round(laborDaily.reduce((acc2, r) => acc2 + r.labor_cost, 0));

  // 月全体＝単一バケットの line|cost_type 集計から fixed / variable を作る
  // （人件費行と仕入行は cost_type 側の分類から除外し、それぞれ専用の扱いにする）
  const bucketMap = alloc.get(start) || new Map();
  let laborOther = 0;
  let purchaseTotal = 0;
  let fixedExpenses = 0;
  let variableExpenses = 0;
  const fixedByLine = {};
  const variableByLine = {};
  for (const [key, amount] of bucketMap) {
    const [line, costType] = key.split('|');
    if (line === 'labor') { laborOther += amount; continue; }
    if (line === 'purchase') { purchaseTotal += amount; continue; }
    if (costType === 'fixed') {
      fixedExpenses += amount;
      fixedByLine[line] = (fixedByLine[line] || 0) + amount;
    } else {
      variableExpenses += amount;
      variableByLine[line] = (variableByLine[line] || 0) + amount;
    }
  }
  laborOther = Math.round(laborOther);
  const laborTotal = laborShift + laborOther;
  const laborIsFixed = settings.labor_is_fixed_for_bep === true;

  const revenue = summary.total_revenue;
  const cogs = summary.total_cost;
  const fixedCosts = Math.round(fixedExpenses + (laborIsFixed ? laborTotal : 0));
  const variableCosts = cogs + variableExpenses + (laborIsFixed ? 0 : laborTotal);
  const variableCostRate = revenue > 0 ? variableCosts / revenue : null;
  const bepRevenue = variableCostRate !== null && variableCostRate < 1
    ? Math.round(fixedCosts / (1 - variableCostRate))
    : null;
  const attainmentPct = bepRevenue !== null && bepRevenue > 0 ? rate(revenue, bepRevenue) : null;
  const safetyMarginPct = bepRevenue !== null && revenue > 0
    ? round1(((revenue - bepRevenue) / revenue) * 100)
    : null;

  // 残営業日の概算: 残暦日 × (経過営業日 ÷ 経過暦日)。月が終わっていれば 0、未来月は null
  const monthDays = bd.diffDays(start, end) + 1;
  const elapsed = Math.max(0, Math.min(bd.diffDays(start, today) + 1, monthDays));
  const remainingCal = monthDays - elapsed;
  let remainingOpenDaysEst = null;
  if (elapsed > 0) {
    remainingOpenDaysEst = remainingCal === 0 ? 0 : Math.round(remainingCal * (summary.open_days / elapsed));
  }
  let requiredPerRemainingDay = null;
  if (bepRevenue !== null && remainingOpenDaysEst !== null && remainingOpenDaysEst > 0) {
    requiredPerRemainingDay = revenue >= bepRevenue ? 0 : Math.round((bepRevenue - revenue) / remainingOpenDaysEst);
  }

  const roundLines = (obj) => {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = Math.round(v);
    return out;
  };
  return {
    month,
    start,
    end,
    fixed_costs: fixedCosts,
    variable_cost_rate: variableCostRate !== null ? Math.round(variableCostRate * 10000) / 10000 : null,
    bep_revenue: bepRevenue,
    actual_revenue: revenue,
    attainment_pct: attainmentPct,
    safety_margin_pct: safetyMarginPct,
    open_days: summary.open_days,
    remaining_open_days_est: remainingOpenDaysEst,
    required_per_remaining_day: requiredPerRemainingDay,
    labor_is_fixed_for_bep: laborIsFixed,
    detail: {
      fixed_detail: {
        expenses_fixed: Math.round(fixedExpenses),
        by_line: roundLines(fixedByLine),
        labor_total: laborIsFixed ? laborTotal : 0,
      },
      variable_detail: {
        cogs_recipe: cogs,
        expenses_variable: Math.round(variableExpenses),
        by_line: roundLines(variableByLine),
        labor_total: laborIsFixed ? 0 : laborTotal,
        excluded_purchase: Math.round(purchaseTotal),
      },
      labor: { labor_shift: laborShift, labor_other: laborOther, labor_total: laborTotal },
    },
  };
}

// ---- エンドポイント ----

// GET /api/v1/pl/statement?start&end&day_mode&granularity=month|fiscal_year（既定 month）
router.get('/statement', async (req, res, next) => {
  try {
    const granularity = parsePlGranularity(req.query.granularity);
    const ctx = await sales.resolveContext({ ...req.query, granularity });
    const data = await fetchStatementData(ctx.start, ctx.end, ctx.B, ctx.granularity, ctx.gopts);
    res.json(await withMeta(
      { start: ctx.start, end: ctx.end, granularity: ctx.granularity, ...data },
      metaExtra(ctx, STATEMENT_NOTE)
    ));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/pl/breakeven?month=YYYY-MM&day_mode
router.get('/breakeven', async (req, res, next) => {
  try {
    const { dayMode, boundaryHour, B } = await sales.resolveModeBoundary(req.query);
    const today = bd.dateOf(dayMode, new Date(), boundaryHour);
    const month = req.query.month !== undefined ? String(req.query.month) : today.slice(0, 7);
    const data = await fetchBreakevenData(month, B, today);
    res.json(await withMeta(data, { day_mode: dayMode, boundary_hour: boundaryHour, note: BREAKEVEN_NOTE }));
  } catch (err) {
    next(err);
  }
});

module.exports = router;

// CSV 出力(routes/export.js)から同一定義を再利用するための追加 export（sales.js と同じ流儀）
module.exports.parsePlGranularity = parsePlGranularity;
module.exports.fetchExpenseAllocation = fetchExpenseAllocation;
module.exports.fetchStatementData = fetchStatementData;
module.exports.fetchBreakevenData = fetchBreakevenData;
module.exports.EXPENSE_LINES = EXPENSE_LINES;
