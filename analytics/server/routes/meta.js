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

const CHECKS = [
  ['readonly_role', checkReadonlyRole],
  ['readonly_enforced', checkReadonlyEnforced],
  ['legacy_reachable', checkLegacyReachable],
  ['snapshot_recorded', checkSnapshotRecorded],
  ['schema_ok', checkSchemaOk],
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
