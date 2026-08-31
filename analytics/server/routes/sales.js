'use strict';
// /api/v1/sales — 期間集計 API（Phase 1）
// - bardb へは pos.query（WITH/SELECT/EXPLAIN ガード付き）のみ。プレースホルダ順は [start, end, TZ, B] を厳守
// - B は実効境界時: day_mode=business なら store_settings.business_day_boundary_hour（boundary_hour クエリで一時上書き可）、
//   day_mode=calendar なら 0（既存 posDefs.RANGE_FILTER＝暦日と同値の範囲になる）
// - 集計定義は posDefs（server/routes/reports.js の追加 export）と同一。
//   売上(orders)と原価(order_items)は必ず別CTE/別クエリで集計する（JOIN すると total_amount が明細行数だけ重複加算される）
// - 応答は withMeta でラップし、meta に day_mode / boundary_hour（必要なら note）を付与する
// - CSV 出力(routes/export.js)と検証(routes/meta.js)から再利用できるよう、fetch 群を末尾で追加 export する
const express = require('express');
const pos = require('../db/pos');
const ana = require('../db/ana');
const posDefs = require('../lib/posDefs');
const bd = require('../lib/businessDay');
const period = require('../lib/period');
const { withMeta } = require('../lib/withMeta');

const router = express.Router();

const { RECIPE_COST_CTE, PAID_FILTER, changePct, rate } = posDefs;

// パラメータ化 SQL 断片（$1=start, $2=end, $3=TZ, $4=B）
const RANGE_W = bd.rangeWhereParam('o.closed_at');    // sargable な期間フィルタ（会計日基準）
const DATE_B = bd.dateExprParam('o.closed_at');       // 営業日/暦日（B=0 で暦日）
const DATE_ITEM = bd.dateExprParam('oi.created_at');  // 明細の営業日/暦日
const HOUR32_ITEM = bd.hour32ExprParam('oi.created_at');
const HOUR32_ORDER = bd.hour32ExprParam('o.closed_at');

// 通常会計（void/black_cancelled 以外）。PAID_FILTER から status 条件を除いた形（adjustments で使用）
const NORMAL_RECEIPT = `(o.receipt_type IS NULL OR o.receipt_type NOT IN ('void', 'black_cancelled'))`;

const MAX_RANGE_DAYS = 3700; // 約10年。0埋めループと重いクエリの暴走防止

const ITEM_BASED_NOTE = '時間帯別の売上・数量は order_items(明細)ベースで、チャージ・深夜料金を含みません';
const HEATMAP_ITEM_NOTE = 'revenue/quantity は order_items(明細)ベース(チャージ・深夜料金を含まず、注文時刻基準)。orders/guests は会計時刻(closed_at)基準';
const TAX_NOTE = '税率別の内税額(tax_standard/tax_reduced)は課税対象額からの逆算(軽減税率は現在の設定値)。total_tax_recorded は会計時に記録された税額の合計。明細0件の会計は税集計に含まれません(既存 /daily と同条件)';
const ADJUSTMENTS_NOTE = 'void/red の日付は取消操作時刻(closed_at)基準';

function badRequest(error) {
  return { status: 400, error };
}

async function loadStoreSettings() {
  const { rows: [row] } = await ana.query(
    'SELECT business_day_boundary_hour, fiscal_year_start_month, week_start_dow, default_day_mode FROM store_settings WHERE id = 1'
  );
  if (!row) throw new Error('store_settings が初期化されていません');
  return row;
}

function parseDayMode(v) {
  if (!bd.MODES.has(v)) throw badRequest("day_mode は 'business' か 'calendar' を指定してください");
  return v;
}

function parseBoundaryHour(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 12) throw badRequest('boundary_hour は 0〜12 の整数を指定してください');
  return n;
}

function parseGranularity(v) {
  if (!bd.GRANULARITIES.has(v)) throw badRequest('granularity は day / week / month / fiscal_year のいずれかを指定してください');
  return v;
}

// day_mode / boundary_hour / B（実効境界時）の解決（calendar・compare 系エンドポイントでも使う）
async function resolveModeBoundary(q) {
  const settings = await loadStoreSettings();
  const dayMode = parseDayMode(q.day_mode !== undefined ? q.day_mode : settings.default_day_mode);
  const boundaryHour = q.boundary_hour !== undefined
    ? parseBoundaryHour(q.boundary_hour)
    : settings.business_day_boundary_hour;
  return { settings, dayMode, boundaryHour, B: bd.effectiveBoundary(dayMode, boundaryHour) };
}

// 共通クエリ（start/end/day_mode/boundary_hour/granularity/compare）の解決
async function resolveContext(q) {
  const { settings, dayMode, boundaryHour, B } = await resolveModeBoundary(q);
  const today = bd.dateOf(dayMode, new Date(), boundaryHour);
  const start = q.start !== undefined ? bd.assertYmd(q.start, 'start') : today;
  const end = q.end !== undefined ? bd.assertYmd(q.end, 'end') : today;
  if (start > end) throw badRequest('start は end 以前の日付を指定してください');
  if (bd.diffDays(start, end) + 1 > MAX_RANGE_DAYS) throw badRequest(`期間は最大 ${MAX_RANGE_DAYS} 日までです`);
  const granularity = q.granularity !== undefined ? parseGranularity(q.granularity) : 'day';
  const compare = period.parseCompare(q.compare);
  return {
    dayMode, boundaryHour, B, start, end, granularity, compare,
    gopts: { weekStartDow: settings.week_start_dow, fiscalYearStartMonth: settings.fiscal_year_start_month },
  };
}

// meta に付与する共通情報（boundary_hour は集計に実際に使った境界時。calendar 時は参考値）
function metaExtra(ctx, note) {
  return { day_mode: ctx.dayMode, boundary_hour: ctx.boundaryHour, ...(note ? { note } : {}) };
}

// ---- fetch 群（SQL は [start, end, TZ, B] のパラメータ配列で実行する）----

// 期間サマリ。既存 /analytics.summary と同じ式（avg_stay は即会計除外・closed>opened のみ）。
// B=0 で暦日＝レガシーと一致する（verify: legacy_match_summary / boundary_zero が検証）
async function fetchSummaryData(start, end, B) {
  const params = [start, end, bd.TZ, B];
  const { rows: [r] } = await pos.query(
    `WITH ${RECIPE_COST_CTE},
     rev AS (
       -- 売上のみ（posDefs.fetchRangeTotals の revenue と同じ JOIN なしの合計）
       SELECT COALESCE(SUM(o.total_amount), 0)::float AS total_revenue
       FROM orders o
       WHERE ${PAID_FILTER} AND ${RANGE_W}
     ),
     stats AS (
       -- 会計単位の集計（既存 /analytics と同じ tables JOIN）
       SELECT
         COUNT(*)::int                                    AS order_count,
         COALESCE(SUM(o.guest_count), 0)::int             AS guest_count,
         COALESCE(SUM(o.tax_amount), 0)::float            AS total_tax,
         COALESCE(SUM(o.discount_amount), 0)::float       AS total_discount,
         COUNT(*) FILTER (WHERE o.discount_amount > 0)::int   AS discount_count,
         COALESCE(SUM(o.gift_cert_amount), 0)::float      AS total_gift_cert,
         COALESCE(SUM(o.charge_amount), 0)::float         AS total_charge,
         COUNT(*) FILTER (WHERE o.charge_amount > 0)::int     AS charge_count,
         COALESCE(SUM(o.late_night_amount), 0)::float     AS total_late_night,
         COUNT(*) FILTER (WHERE o.late_night_amount > 0)::int AS late_night_count,
         COUNT(DISTINCT ${DATE_B})::int                   AS open_days,
         COALESCE(
           AVG(EXTRACT(EPOCH FROM (o.closed_at - o.opened_at)) / 60)
             FILTER (WHERE o.closed_at > o.opened_at AND t.table_type <> 'immediate'),
           0
         )::float AS avg_stay_minutes
       FROM orders o
       JOIN tables t ON o.table_id = t.id
       WHERE ${PAID_FILTER} AND ${RANGE_W}
     ),
     cost AS (
       -- 原価と明細（売上とは必ず別CTE）。costed_revenue は原価設定済み商品の売上（cost_coverage_pct 用）
       SELECT
         COALESCE(SUM(oi.quantity * COALESCE(rc.cost_per_unit, 0)), 0)::float AS total_cost,
         COALESCE(SUM(oi.quantity), 0)::int AS total_item_count,
         COALESCE(SUM(oi.quantity * oi.unit_price), 0)::float AS items_revenue,
         COALESCE(SUM(oi.quantity * oi.unit_price) FILTER (WHERE COALESCE(rc.cost_per_unit, 0) > 0), 0)::float AS costed_revenue
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       LEFT JOIN recipe_cost rc ON rc.menu_item_id = oi.menu_item_id
       WHERE ${PAID_FILTER} AND ${RANGE_W}
     )
     SELECT rev.*, stats.*, cost.* FROM rev, stats, cost`,
    params
  );
  const grossProfit = r.total_revenue - r.total_cost;
  return {
    total_revenue:        r.total_revenue,
    total_cost:           r.total_cost,
    gross_profit:         grossProfit,
    gross_profit_rate:    rate(grossProfit, r.total_revenue),
    cost_coverage_pct:    rate(r.costed_revenue, r.items_revenue),
    order_count:          r.order_count,
    guest_count:          r.guest_count,
    avg_order_value:      r.order_count > 0 ? Math.round(r.total_revenue / r.order_count) : 0,
    avg_per_guest:        r.guest_count > 0 ? Math.round(r.total_revenue / r.guest_count) : 0,
    avg_guests_per_order: r.order_count > 0 ? Math.round((r.guest_count / r.order_count) * 10) / 10 : 0,
    avg_stay_minutes:     Math.round(r.avg_stay_minutes),
    total_item_count:     r.total_item_count,
    total_tax:            r.total_tax,
    total_discount:       r.total_discount,
    discount_count:       r.discount_count,
    total_gift_cert:      r.total_gift_cert,
    total_charge:         r.total_charge,
    charge_count:         r.charge_count,
    total_late_night:     r.total_late_night,
    late_night_count:     r.late_night_count,
    open_days:            r.open_days,
    revenue_per_open_day: r.open_days > 0 ? Math.round(r.total_revenue / r.open_days) : 0,
  };
}

// 推移（granularity バケット・0埋め済み）。verify の conservation / delta_check も day 粒度のこれを使う
async function fetchTrendRows(start, end, B, granularity, gopts = {}) {
  const bucket = bd.bucketExpr(granularity, DATE_B, gopts);
  const params = [start, end, bd.TZ, B];
  const [revQ, costQ] = await Promise.all([
    pos.query(
      `SELECT ${bucket}::text AS period_start,
              COALESCE(SUM(o.total_amount), 0)::float AS revenue,
              COUNT(*)::int AS order_count,
              COALESCE(SUM(o.guest_count), 0)::int AS guest_count
       FROM orders o
       WHERE ${PAID_FILTER} AND ${RANGE_W}
       GROUP BY 1`,
      params
    ),
    pos.query(
      `WITH ${RECIPE_COST_CTE}
       SELECT ${bucket}::text AS period_start,
              COALESCE(SUM(oi.quantity * COALESCE(rc.cost_per_unit, 0)), 0)::float AS total_cost,
              COALESCE(SUM(oi.quantity), 0)::int AS item_count
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       LEFT JOIN recipe_cost rc ON rc.menu_item_id = oi.menu_item_id
       WHERE ${PAID_FILTER} AND ${RANGE_W}
       GROUP BY 1`,
      params
    ),
  ]);
  const revMap = new Map(revQ.rows.map((r) => [r.period_start, r]));
  const costMap = new Map(costQ.rows.map((r) => [r.period_start, r]));
  return bd.enumerateBuckets(granularity, start, end, gopts).map((p) => {
    const rv = revMap.get(p);
    const cs = costMap.get(p);
    const revenue = rv ? rv.revenue : 0;
    const totalCost = cs ? cs.total_cost : 0;
    const guestCount = rv ? rv.guest_count : 0;
    const grossProfit = revenue - totalCost;
    return {
      period_start: p,
      label: bd.label(granularity, p),
      revenue,
      total_cost: totalCost,
      gross_profit: grossProfit,
      gross_profit_rate: rate(grossProfit, revenue),
      order_count: rv ? rv.order_count : 0,
      guest_count: guestCount,
      item_count: cs ? cs.item_count : 0,
      avg_per_guest: guestCount > 0 ? Math.round(revenue / guestCount) : 0,
    };
  });
}

// 曜日別（dow は営業日/暦日の曜日 0=日..6=土）。7行固定で0埋め
async function fetchDowRows(start, end, B) {
  const params = [start, end, bd.TZ, B];
  const [ordersQ, qtyQ] = await Promise.all([
    pos.query(
      `SELECT EXTRACT(DOW FROM ${DATE_B})::int AS dow,
              COALESCE(SUM(o.total_amount), 0)::float AS revenue,
              COUNT(*)::int AS order_count,
              COALESCE(SUM(o.guest_count), 0)::int AS guest_count,
              COUNT(DISTINCT ${DATE_B})::int AS open_days
       FROM orders o
       WHERE ${PAID_FILTER} AND ${RANGE_W}
       GROUP BY 1`,
      params
    ),
    pos.query(
      `SELECT EXTRACT(DOW FROM ${DATE_B})::int AS dow,
              COALESCE(SUM(oi.quantity), 0)::int AS quantity
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       WHERE ${PAID_FILTER} AND ${RANGE_W}
       GROUP BY 1`,
      params
    ),
  ]);
  const oMap = new Map(ordersQ.rows.map((r) => [r.dow, r]));
  const qMap = new Map(qtyQ.rows.map((r) => [r.dow, r.quantity]));
  const out = [];
  for (let dow = 0; dow <= 6; dow++) {
    const o = oMap.get(dow);
    const revenue = o ? o.revenue : 0;
    const openDays = o ? o.open_days : 0;
    const guests = o ? o.guest_count : 0;
    out.push({
      dow,
      label: bd.DOW_LABELS[dow],
      open_days: openDays,
      revenue,
      avg_revenue_per_open_day: openDays > 0 ? Math.round(revenue / openDays) : 0,
      order_count: o ? o.order_count : 0,
      guest_count: guests,
      avg_per_guest: guests > 0 ? Math.round(revenue / guests) : 0,
      quantity: qMap.get(dow) || 0,
    });
  }
  return out;
}

// 時間帯別（明細ベース・既存 /analytics.hourly と同様、期間の絞り込みは会計日・バケットは注文時刻）。
// 営業日軸は B..B+23、暦日(B=0)は 0..23 の24行固定で0埋め
async function fetchHourlyRows(start, end, B) {
  const params = [start, end, bd.TZ, B];
  const { rows } = await pos.query(
    `SELECT ${HOUR32_ITEM} AS hour32,
            COALESCE(SUM(oi.quantity * oi.unit_price), 0)::float AS revenue,
            COALESCE(SUM(oi.quantity), 0)::int AS quantity
     FROM orders o
     JOIN order_items oi ON oi.order_id = o.id
     WHERE ${PAID_FILTER} AND ${RANGE_W}
     GROUP BY 1
     ORDER BY 1`,
    params
  );
  const map = new Map(rows.map((r) => [r.hour32, r]));
  const out = [];
  for (let h = B; h < B + 24; h++) {
    const r = map.get(h);
    out.push({ hour32: h, label: bd.hour32Label(h), revenue: r ? r.revenue : 0, quantity: r ? r.quantity : 0 });
  }
  return out;
}

// 曜日×時間帯ヒートマップ。revenue/quantity は明細（oi.created_at）基準、orders/guests は会計（o.closed_at）基準。
// セルは 7曜×24時間の全てを0埋めで返す
async function fetchHeatmapData(start, end, B, metric) {
  const params = [start, end, bd.TZ, B];
  let sql;
  if (metric === 'revenue' || metric === 'quantity') {
    const valueExpr = metric === 'revenue'
      ? 'COALESCE(SUM(oi.quantity * oi.unit_price), 0)::float'
      : 'COALESCE(SUM(oi.quantity), 0)::int';
    sql = `SELECT EXTRACT(DOW FROM ${DATE_ITEM})::int AS dow, ${HOUR32_ITEM} AS hour32, ${valueExpr} AS value
           FROM orders o
           JOIN order_items oi ON oi.order_id = o.id
           WHERE ${PAID_FILTER} AND ${RANGE_W}
           GROUP BY 1, 2`;
  } else {
    const valueExpr = metric === 'orders' ? 'COUNT(*)::int' : 'COALESCE(SUM(o.guest_count), 0)::int';
    sql = `SELECT EXTRACT(DOW FROM ${DATE_B})::int AS dow, ${HOUR32_ORDER} AS hour32, ${valueExpr} AS value
           FROM orders o
           WHERE ${PAID_FILTER} AND ${RANGE_W}
           GROUP BY 1, 2`;
  }
  const { rows } = await pos.query(sql, params);
  const map = new Map(rows.map((r) => [`${r.dow}:${r.hour32}`, r.value]));
  const cells = [];
  let max = 0;
  for (let dow = 0; dow <= 6; dow++) {
    for (let h = B; h < B + 24; h++) {
      const value = map.get(`${dow}:${h}`) || 0;
      if (value > max) max = value;
      cells.push({ dow, hour32: h, value });
    }
  }
  return { metric, cells, max };
}

// 月間カレンダー。bardb の日別集計と analyticsdb の business_days/tags を JS で結合する
async function fetchCalendarDays(month, B) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month))) {
    throw badRequest('month は YYYY-MM 形式で指定してください');
  }
  const [y, m] = month.split('-').map(Number);
  const start = `${month}-01`;
  const end = `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
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
              COALESCE(
                json_agg(json_build_object('code', t.code, 'name', t.name, 'color', t.color) ORDER BY t.code)
                  FILTER (WHERE t.id IS NOT NULL),
                '[]'::json
              ) AS tags
       FROM business_days d
       LEFT JOIN business_day_tags bt ON bt.business_date = d.business_date
       LEFT JOIN tags t ON t.id = bt.tag_id
       WHERE d.business_date BETWEEN $1 AND $2
       GROUP BY d.business_date, d.is_open, d.weather`,
      [start, end]
    ),
  ]);
  const posMap = new Map(posQ.rows.map((r) => [r.date, r]));
  const anaMap = new Map(anaQ.rows.map((r) => [r.date, r]));
  const days = bd.enumerateBuckets('day', start, end).map((date) => {
    const p = posMap.get(date);
    const a = anaMap.get(date);
    return {
      date,
      revenue: p ? p.revenue : 0,
      order_count: p ? p.order_count : 0,
      guest_count: p ? p.guest_count : 0,
      is_open: a ? a.is_open : null,
      weather: a ? a.weather : null,
      tags: a ? a.tags : [],
    };
  });
  return { month, start, end, days };
}

// 支払方法・金券・チャージ・深夜料金。方法別金額は必ず SUM(cash_amount) 等（分割会計対応）で集計する
async function fetchPaymentsData(start, end, B) {
  const params = [start, end, bd.TZ, B];
  const [aggQ, byPerQ, byDayQ] = await Promise.all([
    pos.query(
      `SELECT
         COALESCE(SUM(o.cash_amount), 0)::float   AS cash_amount,
         COUNT(*) FILTER (WHERE o.cash_amount > 0)::int   AS cash_count,
         COALESCE(SUM(o.card_amount), 0)::float   AS card_amount,
         COUNT(*) FILTER (WHERE o.card_amount > 0)::int   AS card_count,
         COALESCE(SUM(o.emoney_amount), 0)::float AS emoney_amount,
         COUNT(*) FILTER (WHERE o.emoney_amount > 0)::int AS emoney_count,
         COUNT(*) FILTER (WHERE o.payment_method = 'split')::int AS split_count,
         COALESCE(SUM(o.gift_cert_amount) FILTER (WHERE o.gift_cert_no_change = true), 0)::float AS gift_no_change_amount,
         COUNT(*) FILTER (WHERE o.gift_cert_no_change = true AND o.gift_cert_amount > 0)::int    AS gift_no_change_count,
         COALESCE(SUM(o.gift_cert_amount) FILTER (WHERE o.gift_cert_no_change = false AND o.gift_cert_amount > 0), 0)::float AS gift_change_amount,
         COUNT(*) FILTER (WHERE o.gift_cert_no_change = false AND o.gift_cert_amount > 0)::int   AS gift_change_count,
         COALESCE(SUM(o.charge_amount), 0)::float AS charge_amount,
         COUNT(*) FILTER (WHERE o.charge_amount > 0)::int AS charge_count,
         COALESCE(SUM(o.late_night_amount), 0)::float AS late_night_amount,
         COUNT(*) FILTER (WHERE o.late_night_amount > 0)::int AS late_night_count
       FROM orders o
       WHERE ${PAID_FILTER} AND ${RANGE_W}`,
      params
    ),
    pos.query(
      `SELECT o.charge_per_person::float AS charge_per_person,
              COUNT(*)::int AS count,
              COALESCE(SUM(o.charge_amount), 0)::float AS amount
       FROM orders o
       WHERE ${PAID_FILTER} AND ${RANGE_W} AND o.charge_amount > 0
       GROUP BY o.charge_per_person
       ORDER BY 1`,
      params
    ),
    pos.query(
      `SELECT ${DATE_B}::text AS date,
              COALESCE(SUM(o.cash_amount), 0)::float   AS cash,
              COALESCE(SUM(o.card_amount), 0)::float   AS card,
              COALESCE(SUM(o.emoney_amount), 0)::float AS emoney
       FROM orders o
       WHERE ${PAID_FILTER} AND ${RANGE_W}
       GROUP BY 1
       ORDER BY 1`,
      params
    ),
  ]);
  const a = aggQ.rows[0];
  const dayMap = new Map(byDayQ.rows.map((r) => [r.date, r]));
  const by_day = bd.enumerateBuckets('day', start, end).map((date) => {
    const r = dayMap.get(date);
    return { date, cash: r ? r.cash : 0, card: r ? r.card : 0, emoney: r ? r.emoney : 0 };
  });
  return {
    methods: [
      { method: 'cash',   label: '現金',       count: a.cash_count,   amount: a.cash_amount },
      { method: 'card',   label: 'カード',     count: a.card_count,   amount: a.card_amount },
      { method: 'emoney', label: '電子マネー', count: a.emoney_count, amount: a.emoney_amount },
    ],
    split_count: a.split_count,
    gift: {
      no_change_amount: a.gift_no_change_amount,
      no_change_count:  a.gift_no_change_count,
      change_amount:    a.gift_change_amount,
      change_count:     a.gift_change_count,
    },
    charge: { amount: a.charge_amount, count: a.charge_count, by_per_person: byPerQ.rows },
    late_night: { amount: a.late_night_amount, count: a.late_night_count },
    by_day,
  };
}

// 軽減税率（bardb の system_settings。既存 payments.js が会計時に読むのと同じキー）
async function loadReducedTaxRate() {
  const { rows } = await pos.query(`SELECT value FROM system_settings WHERE key = 'reduced_tax_rate'`);
  const v = parseFloat(rows[0] ? rows[0].value : NaN);
  return Number.isFinite(v) && v >= 0 && v < 1 ? v : 0.08;
}

// 税率別課税対象額（既存 /daily の式を期間化。割引は標準税率分から先に適用）。
// JOIN order_items は /daily と同じ内部結合（明細0件の会計は含まれない）
async function fetchTaxData(start, end, B) {
  const rr = await loadReducedTaxRate(); // 検証済み数値のみ SQL に埋め込む
  const params = [start, end, bd.TZ, B];
  const { rows } = await pos.query(
    `SELECT b.date::text AS date,
       COALESCE(SUM(GREATEST(0, b.std_items + b.chg + b.ln - b.disc)), 0)::float AS taxable_standard,
       COALESCE(SUM(GREATEST(0, b.red_items - GREATEST(0, b.disc - b.std_items - b.chg - b.ln))), 0)::float AS taxable_reduced,
       COALESCE(SUM(ROUND((GREATEST(0, b.std_items + b.chg + b.ln - b.disc) * b.tr / (1 + b.tr))::numeric)), 0)::float AS tax_standard,
       COALESCE(SUM(ROUND((GREATEST(0, b.red_items - GREATEST(0, b.disc - b.std_items - b.chg - b.ln)) * ${rr} / (1 + ${rr}))::numeric)), 0)::float AS tax_reduced,
       COALESCE(SUM(b.tax_recorded), 0)::float AS tax_recorded
     FROM (
       SELECT
         ${DATE_B} AS date,
         COALESCE(o.discount_amount, 0)   AS disc,
         COALESCE(o.charge_amount, 0)     AS chg,
         COALESCE(o.late_night_amount, 0) AS ln,
         COALESCE(o.tax_rate, 0.1)::float AS tr,
         COALESCE(o.tax_amount, 0)::float AS tax_recorded,
         COALESCE(SUM(oi.quantity * oi.unit_price)
           FILTER (WHERE COALESCE(m.tax_category, 'standard') <> 'reduced'), 0) AS std_items,
         COALESCE(SUM(oi.quantity * oi.unit_price)
           FILTER (WHERE m.tax_category = 'reduced'), 0) AS red_items
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       JOIN menu_items m ON oi.menu_item_id = m.id
       WHERE ${PAID_FILTER} AND ${RANGE_W}
       GROUP BY o.id
     ) b
     GROUP BY b.date
     ORDER BY b.date`,
    params
  );
  const sum = (k) => rows.reduce((acc, r) => acc + r[k], 0);
  return {
    taxable_standard:   sum('taxable_standard'),
    taxable_reduced:    sum('taxable_reduced'),
    tax_standard:       sum('tax_standard'),
    tax_reduced:        sum('tax_reduced'),
    total_tax_recorded: sum('tax_recorded'),
    reduced_tax_rate:   rr,
    by_day: rows.map((r) => ({ date: r.date, taxable_standard: r.taxable_standard, taxable_reduced: r.taxable_reduced })),
  };
}

// 割引・取消(void)・赤伝票(red)。void/red は既存 /daily と同条件（status='paid' の該当 receipt_type）
async function fetchAdjustmentsData(start, end, B) {
  const params = [start, end, bd.TZ, B];
  const { rows } = await pos.query(
    `SELECT ${DATE_B}::text AS date,
       COALESCE(SUM(o.discount_amount) FILTER (WHERE ${NORMAL_RECEIPT}), 0)::float AS discount_amount,
       COUNT(*) FILTER (WHERE ${NORMAL_RECEIPT} AND o.discount_amount > 0)::int    AS discount_count,
       COALESCE(SUM(o.total_amount) FILTER (WHERE o.receipt_type = 'void'), 0)::float AS void_amount,
       COUNT(*) FILTER (WHERE o.receipt_type = 'void')::int                           AS void_count,
       COALESCE(SUM(o.total_amount) FILTER (WHERE o.receipt_type = 'red'), 0)::float  AS red_amount,
       COUNT(*) FILTER (WHERE o.receipt_type = 'red')::int                            AS red_count
     FROM orders o
     WHERE o.status = 'paid' AND ${RANGE_W}
     GROUP BY 1
     ORDER BY 1`,
    params
  );
  const sum = (k) => rows.reduce((acc, r) => acc + r[k], 0);
  return {
    discount: { count: sum('discount_count'), amount: sum('discount_amount') },
    void:     { count: sum('void_count'),     amount: sum('void_amount') },
    red:      { count: sum('red_count'),      amount: sum('red_amount') },
    // by_day は動きのあった日のみ（割引・取消とも0の日は省く）
    by_day: rows
      .filter((r) => r.discount_amount > 0 || r.void_amount > 0 || r.red_amount > 0
        || r.discount_count > 0 || r.void_count > 0 || r.red_count > 0)
      .map((r) => ({ date: r.date, discount_amount: r.discount_amount, void_amount: r.void_amount, red_amount: r.red_amount })),
  };
}

// ---- エンドポイント ----

// GET /api/v1/sales/summary
router.get('/summary', async (req, res, next) => {
  try {
    const ctx = await resolveContext(req.query);
    const summary = await fetchSummaryData(ctx.start, ctx.end, ctx.B);
    const comparison = {};
    await Promise.all(ctx.compare.map(async (key) => {
      const r = period.comparisonRange(key, ctx.start, ctx.end);
      const prev = await fetchSummaryData(r.start, r.end, ctx.B);
      comparison[key] = {
        start: r.start,
        end: r.end,
        total_revenue: prev.total_revenue,
        gross_profit:  prev.gross_profit,
        order_count:   prev.order_count,
        guest_count:   prev.guest_count,
        avg_per_guest: prev.avg_per_guest,
        revenue_change_pct:       changePct(summary.total_revenue, prev.total_revenue),
        gross_profit_change_pct:  changePct(summary.gross_profit,  prev.gross_profit),
        order_count_change_pct:   changePct(summary.order_count,   prev.order_count),
        guest_count_change_pct:   changePct(summary.guest_count,   prev.guest_count),
        avg_per_guest_change_pct: changePct(summary.avg_per_guest, prev.avg_per_guest),
      };
    }));
    res.json(await withMeta({ start: ctx.start, end: ctx.end, summary, comparison }, metaExtra(ctx)));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/sales/trend（比較系列は compare の先頭1つのみ対象）
router.get('/trend', async (req, res, next) => {
  try {
    const ctx = await resolveContext(req.query);
    const rows = await fetchTrendRows(ctx.start, ctx.end, ctx.B, ctx.granularity, ctx.gopts);
    const payload = { start: ctx.start, end: ctx.end, granularity: ctx.granularity, rows };
    if (ctx.compare.length > 0) {
      const key = ctx.compare[0];
      const r = period.comparisonRange(key, ctx.start, ctx.end);
      payload.compare_key = key;
      payload.compare_start = r.start;
      payload.compare_end = r.end;
      payload.compare_rows = await fetchTrendRows(r.start, r.end, ctx.B, ctx.granularity, ctx.gopts);
    }
    res.json(await withMeta(payload, metaExtra(ctx)));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/sales/dow
router.get('/dow', async (req, res, next) => {
  try {
    const ctx = await resolveContext(req.query);
    const rows = await fetchDowRows(ctx.start, ctx.end, ctx.B);
    res.json(await withMeta({ start: ctx.start, end: ctx.end, rows }, metaExtra(ctx)));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/sales/hourly
router.get('/hourly', async (req, res, next) => {
  try {
    const ctx = await resolveContext(req.query);
    const rows = await fetchHourlyRows(ctx.start, ctx.end, ctx.B);
    res.json(await withMeta({ start: ctx.start, end: ctx.end, rows }, metaExtra(ctx, ITEM_BASED_NOTE)));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/sales/heatmap?metric=revenue|quantity|orders|guests
router.get('/heatmap', async (req, res, next) => {
  try {
    const ctx = await resolveContext(req.query);
    const metric = req.query.metric !== undefined ? String(req.query.metric) : 'revenue';
    if (!['revenue', 'quantity', 'orders', 'guests'].includes(metric)) {
      throw badRequest('metric は revenue / quantity / orders / guests のいずれかを指定してください');
    }
    const data = await fetchHeatmapData(ctx.start, ctx.end, ctx.B, metric);
    res.json(await withMeta({ start: ctx.start, end: ctx.end, ...data }, metaExtra(ctx, HEATMAP_ITEM_NOTE)));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/sales/calendar?month=YYYY-MM
router.get('/calendar', async (req, res, next) => {
  try {
    const { dayMode, boundaryHour, B } = await resolveModeBoundary(req.query);
    const month = req.query.month !== undefined
      ? String(req.query.month)
      : bd.dateOf(dayMode, new Date(), boundaryHour).slice(0, 7);
    const data = await fetchCalendarDays(month, B);
    res.json(await withMeta(data, { day_mode: dayMode, boundary_hour: boundaryHour }));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/sales/payments
router.get('/payments', async (req, res, next) => {
  try {
    const ctx = await resolveContext(req.query);
    const data = await fetchPaymentsData(ctx.start, ctx.end, ctx.B);
    res.json(await withMeta({ start: ctx.start, end: ctx.end, ...data }, metaExtra(ctx)));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/sales/tax
router.get('/tax', async (req, res, next) => {
  try {
    const ctx = await resolveContext(req.query);
    const data = await fetchTaxData(ctx.start, ctx.end, ctx.B);
    res.json(await withMeta({ start: ctx.start, end: ctx.end, ...data }, metaExtra(ctx, TAX_NOTE)));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/sales/adjustments
router.get('/adjustments', async (req, res, next) => {
  try {
    const ctx = await resolveContext(req.query);
    const data = await fetchAdjustmentsData(ctx.start, ctx.end, ctx.B);
    res.json(await withMeta({ start: ctx.start, end: ctx.end, ...data }, metaExtra(ctx, ADJUSTMENTS_NOTE)));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/sales/compare?a_start&a_end&b_start&b_end&day_mode
router.get('/compare', async (req, res, next) => {
  try {
    const { dayMode, boundaryHour, B } = await resolveModeBoundary(req.query);
    const aStart = bd.assertYmd(req.query.a_start, 'a_start');
    const aEnd = bd.assertYmd(req.query.a_end, 'a_end');
    const bStart = bd.assertYmd(req.query.b_start, 'b_start');
    const bEnd = bd.assertYmd(req.query.b_end, 'b_end');
    if (aStart > aEnd || bStart > bEnd) throw badRequest('開始日は終了日以前の日付を指定してください');
    if (bd.diffDays(aStart, aEnd) + 1 > MAX_RANGE_DAYS || bd.diffDays(bStart, bEnd) + 1 > MAX_RANGE_DAYS) {
      throw badRequest(`期間は最大 ${MAX_RANGE_DAYS} 日までです`);
    }
    const [a, b] = await Promise.all([
      fetchSummaryData(aStart, aEnd, B),
      fetchSummaryData(bStart, bEnd, B),
    ]);
    const diff = {};
    for (const [k, v] of Object.entries(a)) {
      if (typeof v === 'number') diff[`${k}_change_pct`] = changePct(v, b[k]);
    }
    res.json(await withMeta({
      a: { start: aStart, end: aEnd, summary: a },
      b: { start: bStart, end: bEnd, summary: b },
      diff,
    }, { day_mode: dayMode, boundary_hour: boundaryHour }));
  } catch (err) {
    next(err);
  }
});

module.exports = router;

// CSV 出力(routes/export.js)と検証(routes/meta.js)から同一定義を再利用するための追加 export（既存挙動は不変）
module.exports.resolveContext = resolveContext;
module.exports.resolveModeBoundary = resolveModeBoundary;
module.exports.fetchSummaryData = fetchSummaryData;
module.exports.fetchTrendRows = fetchTrendRows;
module.exports.fetchDowRows = fetchDowRows;
module.exports.fetchHourlyRows = fetchHourlyRows;
module.exports.fetchHeatmapData = fetchHeatmapData;
module.exports.fetchCalendarDays = fetchCalendarDays;
module.exports.fetchPaymentsData = fetchPaymentsData;
module.exports.fetchTaxData = fetchTaxData;
module.exports.fetchAdjustmentsData = fetchAdjustmentsData;
