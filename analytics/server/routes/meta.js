'use strict';
// /api/v1/meta — 稼働状態・スナップショット取込記録・整合性検証
const express = require('express');
const { Client } = require('pg');
const pos = require('../db/pos');
const ana = require('../db/ana');
const posDefs = require('../lib/posDefs');
const { withMeta, invalidateMeta } = require('../lib/withMeta');
const { todayCalendar } = require('../lib/businessDay');
const logger = require('../lib/logger');

const router = express.Router();
const startedAt = Date.now();

// bardb の現在件数（読み取りのみ）
async function currentCounts() {
  const { rows: [r] } = await pos.query(
    `SELECT (SELECT COUNT(*)::int FROM orders)        AS orders_count,
            (SELECT COUNT(*)::int FROM order_items)   AS order_items_count,
            (SELECT MAX(closed_at) FROM orders)       AS max_closed_at`
  );
  return r;
}

async function latestImport() {
  const { rows: [row] } = await ana.query(
    `SELECT id, imported_at, dump_file, orders_count, order_items_count, max_closed_at, parity_ok, parity_detail
     FROM snapshot_imports ORDER BY imported_at DESC, id DESC LIMIT 1`
  );
  return row || null;
}

function sameInstant(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return new Date(a).getTime() === new Date(b).getTime();
}

// GET /api/v1/meta/health
router.get('/health', async (req, res) => {
  const result = {
    ok: false,
    service: 'bar-analytics-server',
    now: new Date().toISOString(),
    uptime_s: Math.round((Date.now() - startedAt) / 1000),
    pos: { connected: false, self_check: null, error: null },
    analytics: { connected: false, migrations: null, error: null },
  };
  try {
    result.pos.self_check = await pos.selfCheck();
    result.pos.connected = true;
  } catch (err) {
    result.pos.error = err.message;
  }
  try {
    await ana.ping();
    result.analytics.connected = true;
    const { rows } = await ana.query('SELECT version FROM schema_migrations ORDER BY version');
    result.analytics.migrations = rows.map((r) => r.version);
  } catch (err) {
    result.analytics.error = err.message;
  }
  result.ok = result.pos.connected && result.pos.self_check?.ok === true && result.analytics.connected;
  res.status(result.ok ? 200 : 503).json(await withMeta(result));
});

// GET /api/v1/meta/sync-status
router.get('/sync-status', async (req, res, next) => {
  try {
    const [latest, current] = await Promise.all([latestImport(), currentCounts()]);
    const drift = latest
      ? latest.orders_count !== current.orders_count || latest.order_items_count !== current.order_items_count
      : null;
    res.json(await withMeta({
      latest_import: latest,
      current,
      drift,
      max_closed_at_changed: latest ? !sameInstant(latest.max_closed_at, current.max_closed_at) : null,
    }));
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/meta/sync { dump_file }
// bardb の現在件数を数えて snapshot_imports に記録する（bardb には書かない）
// parity: 前回記録より件数が減っていない（巻き戻っていない）こと、かつ orders が 0 件でないこと
router.post('/sync', async (req, res, next) => {
  try {
    const raw = req.body && req.body.dump_file;
    if (raw != null && typeof raw !== 'string') {
      return res.status(400).json({ error: 'dump_file は文字列で指定してください' });
    }
    const dumpFile = raw ? raw.split(/[\\/]/).pop().slice(0, 255) : null;

    const [current, previous] = await Promise.all([currentCounts(), latestImport()]);
    const regressed = previous
      ? current.orders_count < previous.orders_count || current.order_items_count < previous.order_items_count
      : false;
    const parityDetail = {
      orders_count: current.orders_count,
      order_items_count: current.order_items_count,
      max_closed_at: current.max_closed_at,
      previous_orders_count: previous ? previous.orders_count : null,
      previous_order_items_count: previous ? previous.order_items_count : null,
      previous_max_closed_at: previous ? previous.max_closed_at : null,
      orders_delta: previous ? current.orders_count - previous.orders_count : null,
      regressed,
    };
    const parityOk = current.orders_count > 0 && !regressed;

    const { rows: [row] } = await ana.query(
      `INSERT INTO snapshot_imports (dump_file, orders_count, order_items_count, max_closed_at, parity_ok, parity_detail)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       RETURNING id, imported_at, dump_file, orders_count, order_items_count, max_closed_at, parity_ok, parity_detail`,
      [dumpFile, current.orders_count, current.order_items_count, current.max_closed_at, parityOk, JSON.stringify(parityDetail)]
    );
    invalidateMeta();
    logger.info('snapshot import recorded', { id: row.id, dump_file: dumpFile, orders_count: row.orders_count });
    res.status(201).json(await withMeta({ import: row }));
  } catch (err) {
    next(err);
  }
});

// ---- verify チェック群 ----

async function checkReadonlyRole() {
  const sc = await pos.selfCheck();
  return { ok: sc.ok, detail: sc };
}

// pos.js の Pool で SELECT が通り、素の pg クライアント（SET なし）で CREATE TEMP TABLE が
// read-only エラー(25006)になること。成功してしまったら ok=false
async function checkReadonlyEnforced() {
  const detail = { select_ok: false, create_rejected: false, create_error_code: null, create_error_message: null };
  const { rows } = await pos.query('SELECT 1 AS one');
  detail.select_ok = rows[0]?.one === 1;

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('CREATE TEMP TABLE _x(a int)');
    // ここに来たら書けてしまっている（TEMP なので切断で消えるが ok=false）
    detail.create_rejected = false;
  } catch (err) {
    detail.create_rejected = true;
    detail.create_error_code = err.code || null;
    detail.create_error_message = err.message;
  } finally {
    await client.end().catch(() => {});
  }
  const ok = detail.select_ok && detail.create_rejected && detail.create_error_code === '25006';
  return { ok, detail };
}

// in-process で legacy analytics を叩き、summary.total_revenue が posDefs.fetchRangeTotals と一致すること
async function checkLegacyReachable() {
  const port = process.env.PORT || 3101;
  const end = todayCalendar();
  const startDate = new Date(`${end}T00:00:00Z`);
  startDate.setUTCDate(startDate.getUTCDate() - 30);
  const start = startDate.toISOString().slice(0, 10);
  const url = `http://127.0.0.1:${port}/api/legacy/reports/analytics?start=${start}&end=${end}`;

  const detail = { url, start, end, status: null, legacy_total_revenue: null, defs_total_revenue: null, diff: null };
  const resp = await fetch(url);
  detail.status = resp.status;
  if (resp.status !== 200) return { ok: false, detail };
  const body = await resp.json();
  const legacyRevenue = body?.summary?.total_revenue;
  const totals = await posDefs.fetchRangeTotals(start, end);
  detail.legacy_total_revenue = legacyRevenue;
  detail.defs_total_revenue = totals.total_revenue;
  const diff = Math.abs(Number(legacyRevenue) - Number(totals.total_revenue));
  detail.diff = diff;
  return { ok: typeof legacyRevenue === 'number' && diff < 0.005, detail };
}

async function checkSnapshotRecorded() {
  const [latest, current] = await Promise.all([latestImport(), currentCounts()]);
  const detail = {
    recorded: !!latest,
    imported_at: latest ? latest.imported_at : null,
    recorded_orders_count: latest ? latest.orders_count : null,
    recorded_order_items_count: latest ? latest.order_items_count : null,
    current_orders_count: current.orders_count,
    current_order_items_count: current.order_items_count,
  };
  const ok = !!latest
    && latest.orders_count === current.orders_count
    && latest.order_items_count === current.order_items_count;
  return { ok, detail };
}

async function checkSchemaOk() {
  const { rows } = await ana.query('SELECT version, applied_at FROM schema_migrations ORDER BY version');
  const versions = rows.map((r) => r.version);
  return { ok: versions.includes('0001'), detail: { applied: versions } };
}

// ---- Phase 1: 営業日集計の一致検証 ----
// 集計本体は routes/sales.js の fetch 群を再利用する（HTTP を介さず in-process で呼ぶ。
// legacy 側のみ checkLegacyReachable と同様に in-process HTTP で叩く）
const bd = require('../lib/businessDay');
const sales = require('./sales');
const pricing = require('./pricing'); // Phase 5: 値引き費用の legacy 一致検証

const VERIFY_EPS = 0.005;               // 金額一致の許容誤差 |Δ| < 0.005
const VERIFY_FULL_START = '2026-07-01'; // 運用データ開始月＝「全期間」チェックの起点

function nearlyEqual(a, b) {
  return Math.abs(Number(a) - Number(b)) < VERIFY_EPS;
}

async function settingsBoundary() {
  const { rows: [r] } = await ana.query('SELECT business_day_boundary_hour FROM store_settings WHERE id = 1');
  return r ? r.business_day_boundary_hour : 9;
}

// legacy_match 用の3期間（直近7日・今月・全期間）。すべて暦日基準
function verifyPeriods() {
  const today = todayCalendar();
  return [
    { name: 'last_7_days', start: bd.addDays(today, -6), end: today },
    { name: 'this_month', start: `${today.slice(0, 7)}-01`, end: today },
    { name: 'full_range', start: VERIFY_FULL_START, end: today },
  ];
}

async function fetchLegacyJson(pathname) {
  const port = process.env.PORT || 3101;
  const resp = await fetch(`http://127.0.0.1:${port}${pathname}`);
  if (resp.status !== 200) throw new Error(`legacy API が ${resp.status} を返しました: ${pathname}`);
  return resp.json();
}

// day_mode=calendar(B=0) の summary が in-process の /api/legacy/reports/analytics と一致すること
async function checkLegacyMatchSummary() {
  const KEYS = ['total_revenue', 'total_cost', 'gross_profit', 'order_count', 'guest_count', 'avg_stay_minutes'];
  const periods = [];
  for (const p of verifyPeriods()) {
    const [legacy, mine] = await Promise.all([
      fetchLegacyJson(`/api/legacy/reports/analytics?start=${p.start}&end=${p.end}`),
      sales.fetchSummaryData(p.start, p.end, 0), // calendar 相当（B=0）
    ]);
    const mismatches = {};
    for (const k of KEYS) {
      if (!nearlyEqual(mine[k], legacy.summary[k])) mismatches[k] = { v1: mine[k], legacy: legacy.summary[k] };
    }
    const ok = Object.keys(mismatches).length === 0;
    periods.push({ period: p.name, start: p.start, end: p.end, ok, ...(ok ? {} : { mismatches }) });
  }
  return { ok: periods.every((r) => r.ok), detail: { keys: KEYS, periods } };
}

// trend(day, calendar) の日別が /api/legacy/reports/profit-summary と一致すること（legacy に無い日は0扱い）
async function checkLegacyMatchDaily() {
  const start = VERIFY_FULL_START;
  const end = todayCalendar();
  const [legacy, trend] = await Promise.all([
    fetchLegacyJson(`/api/legacy/reports/profit-summary?start=${start}&end=${end}`),
    sales.fetchTrendRows(start, end, 0, 'day'),
  ]);
  const legacyMap = new Map(legacy.rows.map((r) => [r.date, r]));
  const mismatches = [];
  for (const row of trend) {
    const l = legacyMap.get(row.period_start) || { revenue: 0, total_cost: 0, gross_profit: 0 };
    for (const k of ['revenue', 'total_cost', 'gross_profit']) {
      if (!nearlyEqual(row[k], l[k])) mismatches.push({ date: row.period_start, key: k, v1: row[k], legacy: l[k] });
    }
  }
  return {
    ok: mismatches.length === 0,
    detail: {
      start, end,
      days_checked: trend.length,
      legacy_days: legacy.rows.length,
      mismatch_count: mismatches.length,
      mismatches: mismatches.slice(0, 5),
    },
  };
}

// 保存則: 全期間で Σtrend(business) == Σtrend(calendar) == 直接 SUM（範囲フィルタなし・PAID_FILTER のみ）
async function checkConservation() {
  const start = VERIFY_FULL_START;
  const end = todayCalendar();
  const boundary = await settingsBoundary();
  const [trendBiz, trendCal, { rows: [direct] }] = await Promise.all([
    sales.fetchTrendRows(start, end, boundary, 'day'),
    sales.fetchTrendRows(start, end, 0, 'day'),
    pos.query(
      `SELECT COALESCE(SUM(o.total_amount), 0)::float AS revenue,
              COUNT(*)::int AS order_count,
              COALESCE(SUM(o.guest_count), 0)::int AS guest_count
       FROM orders o
       WHERE ${posDefs.PAID_FILTER}`
    ),
  ]);
  const sum = (rows, k) => rows.reduce((acc, r) => acc + r[k], 0);
  const detail = { start, end, boundary_hour: boundary, metrics: {} };
  let ok = true;
  for (const k of ['revenue', 'order_count', 'guest_count']) {
    const b = sum(trendBiz, k);
    const c = sum(trendCal, k);
    const d = direct[k];
    const rowOk = nearlyEqual(b, c) && nearlyEqual(c, d);
    detail.metrics[k] = { business: b, calendar: c, direct: d, ok: rowOk };
    if (!rowOk) ok = false;
  }
  return { ok, detail };
}

// boundary_hour=0 の business summary が calendar summary と一致すること（全期間）
async function checkBoundaryZero() {
  const start = VERIFY_FULL_START;
  const end = todayCalendar();
  const boundary = await settingsBoundary();
  const [biz0, cal] = await Promise.all([
    sales.fetchSummaryData(start, end, bd.effectiveBoundary('business', 0)),
    sales.fetchSummaryData(start, end, bd.effectiveBoundary('calendar', boundary)),
  ]);
  const mismatches = {};
  let keysChecked = 0;
  for (const [k, v] of Object.entries(biz0)) {
    if (typeof v !== 'number') continue;
    keysChecked += 1;
    if (!nearlyEqual(v, cal[k])) mismatches[k] = { business0: v, calendar: cal[k] };
  }
  const ok = Object.keys(mismatches).length === 0;
  return { ok, detail: { start, end, keys_checked: keysChecked, ...(ok ? {} : { mismatches }) } };
}

// 差分検算: 直近14日の各暦日 D で business(D) = calendar(D) − late(D) + late(D+1)
// late(X) = 暦日 X の 0時〜B時（境界前）の会計合計
async function checkDeltaCheck() {
  const end = todayCalendar();
  const start = bd.addDays(end, -13);
  const boundary = await settingsBoundary();
  const [biz, cal, lateQ] = await Promise.all([
    sales.fetchTrendRows(start, end, boundary, 'day'),
    sales.fetchTrendRows(start, end, 0, 'day'),
    pos.query(
      // late(D13+1) も要るため end+1 まで拾う。パラメタ順は [start, end, TZ, B]
      `SELECT (o.closed_at AT TIME ZONE $3)::date::text AS date,
              COALESCE(SUM(o.total_amount), 0)::float AS revenue
       FROM orders o
       WHERE ${posDefs.PAID_FILTER}
         AND (o.closed_at AT TIME ZONE $3)::date BETWEEN $1::date AND $2::date
         AND EXTRACT(HOUR FROM (o.closed_at AT TIME ZONE $3))::int < $4::int
       GROUP BY 1`,
      [start, bd.addDays(end, 1), bd.TZ, boundary]
    ),
  ]);
  const late = new Map(lateQ.rows.map((r) => [r.date, r.revenue]));
  const calMap = new Map(cal.map((r) => [r.period_start, r.revenue]));
  const mismatches = [];
  for (const row of biz) {
    const d = row.period_start;
    const expected = (calMap.get(d) || 0) - (late.get(d) || 0) + (late.get(bd.addDays(d, 1)) || 0);
    if (!nearlyEqual(row.revenue, expected)) {
      mismatches.push({ date: d, business: row.revenue, expected });
    }
  }
  return {
    ok: mismatches.length === 0,
    detail: { start, end, boundary_hour: boundary, days_checked: biz.length, mismatches: mismatches.slice(0, 5) },
  };
}

// Phase 5: 値引き費用(暴落原資)が /api/legacy/reports/discount-cost と一致すること。
// /api/v1/pricing/effect の discount は同じ式を day_mode 対応で書き直したものなので、
// day_mode=calendar(B=0) では legacy と厳密に一致していなければならない
async function checkLegacyMatchDiscountCost() {
  const KEYS = [['total', 'total'], ['net_diff', 'net_diff'], ['month_total', 'month_total']];
  const periods = [];
  for (const p of verifyPeriods()) {
    const [legacy, mine] = await Promise.all([
      fetchLegacyJson(`/api/legacy/reports/discount-cost?start=${p.start}&end=${p.end}`),
      pricing.fetchEffectData(p.start, p.end, 0), // calendar 相当（B=0）
    ]);
    const mismatches = {};
    for (const [mk, lk] of KEYS) {
      if (!nearlyEqual(mine.discount[mk], legacy[lk])) {
        mismatches[mk] = { v1: mine.discount[mk], legacy: legacy[lk] };
      }
    }
    // 日次内訳（legacy.daily[].cost）も突き合わせる（合計が偶然一致しても日別のズレを見逃さない）。
    // legacy 側の date は ::text キャストが無く pg が Date に変換するため（"2026-07-10T15:00:00.000Z" のような
    // JST 深夜0時の ISO 文字列になる）、v1 と同じ YYYY-MM-DD へ揃えてから突き合わせる
    const ymdOf = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : bd.calendarDateOf(new Date(v)));
    const legacyDaily = new Map((legacy.daily || []).map((d) => [ymdOf(d.date), d.cost]));
    const dayMismatches = [];
    for (const d of mine.discount.by_day) {
      if (!nearlyEqual(d.amount, legacyDaily.get(d.date) || 0)) {
        dayMismatches.push({ date: d.date, v1: d.amount, legacy: legacyDaily.get(d.date) || 0 });
      }
    }
    const ok = Object.keys(mismatches).length === 0 && dayMismatches.length === 0;
    periods.push({
      period: p.name, start: p.start, end: p.end, ok,
      ...(ok ? {} : { mismatches, day_mismatches: dayMismatches.slice(0, 5) }),
    });
  }
  return { ok: periods.every((r) => r.ok), detail: { keys: KEYS.map((k) => k[0]), periods } };
}

const CHECKS = [
  ['readonly_role', checkReadonlyRole],
  ['readonly_enforced', checkReadonlyEnforced],
  ['legacy_reachable', checkLegacyReachable],
  ['snapshot_recorded', checkSnapshotRecorded],
  ['schema_ok', checkSchemaOk],
  // Phase 1: 営業日集計の一致検証
  ['legacy_match_summary', checkLegacyMatchSummary],
  ['legacy_match_daily', checkLegacyMatchDaily],
  ['conservation', checkConservation],
  ['boundary_zero', checkBoundaryZero],
  ['delta_check', checkDeltaCheck],
  // Phase 5: 価格変動効果 API の値引き費用が legacy と同一定義であること
  ['legacy_match_discount_cost', checkLegacyMatchDiscountCost],
];

async function runChecks() {
  const results = [];
  for (const [name, fn] of CHECKS) {
    try {
      const r = await fn();
      results.push({ check_name: name, ok: r.ok === true, detail: r.detail ?? null });
    } catch (err) {
      results.push({ check_name: name, ok: false, detail: { error: err.message, code: err.code || null } });
    }
  }
  return results;
}

// POST /api/v1/meta/verify
router.post('/verify', async (req, res, next) => {
  try {
    const checks = await runChecks();
    const runAt = new Date();
    const client = await ana.pool.connect();
    try {
      await client.query('BEGIN');
      for (const c of checks) {
        await client.query(
          'INSERT INTO verification_runs (run_at, check_name, ok, detail) VALUES ($1, $2, $3, $4::jsonb)',
          [runAt, c.check_name, c.ok, JSON.stringify(c.detail)]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    const ok = checks.every((c) => c.ok);
    logger.info('verify finished', { ok, failed: checks.filter((c) => !c.ok).map((c) => c.check_name) });
    res.json(await withMeta({ ok, run_at: runAt, checks }));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/meta/verify/latest
router.get('/verify/latest', async (req, res, next) => {
  try {
    const { rows } = await ana.query(
      `SELECT run_at, check_name, ok, detail FROM verification_runs
       WHERE run_at = (SELECT MAX(run_at) FROM verification_runs)
       ORDER BY id`
    );
    if (rows.length === 0) {
      return res.json(await withMeta({ ok: null, run_at: null, checks: [] }));
    }
    res.json(await withMeta({
      ok: rows.every((r) => r.ok),
      run_at: rows[0].run_at,
      checks: rows.map((r) => ({ check_name: r.check_name, ok: r.ok, detail: r.detail })),
    }));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
