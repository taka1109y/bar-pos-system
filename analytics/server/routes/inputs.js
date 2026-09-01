'use strict';
// /api/v1/seat-capacities・/api/v1/register-closings — 入力系 API（Phase 3）
// - 2つの小さなリソースを1ファイルに並置し、index.js からは '/api/v1' にマウントする
// - 席数（seat_capacities）・レジ精算（register_closings）は analyticsdb（ana.query = CRUD 可）
// - bardb へは pos.query（SELECT のみ）: 卓一覧の採取と、現金売上 SUM(cash_amount)（分割会計対応の既存定義）
//   プレースホルダ順は [start, end, TZ, B] を厳守
// - register_closings.system_cash はサーバが open_cash + cash_sales で算出して upsert する
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

const MAX_SEAT_ROWS = 200;
const MAX_CASH = 10_000_000;

const CLOSINGS_NOTE =
  'cash_sales はその営業日の現金売上 SUM(cash_amount)（分割会計の現金分を含む・金券は非現金として控除済み）。' +
  'system_cash = open_cash + cash_sales はサーバが算出する';

function badRequest(error) {
  return { status: 400, error };
}

// ---- 入力検証（不正なら {status, error} を throw する既存流儀）----

function parseCash(v, name) {
  if (!Number.isInteger(v) || v < 0 || v > MAX_CASH) {
    throw badRequest(`${name} は 0〜${MAX_CASH} の整数を指定してください`);
  }
  return v;
}

function parseMemo(v) {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw badRequest('memo は文字列で指定してください');
  const s = v.trim();
  if (s.length > 500) throw badRequest('memo は 500 文字以内で指定してください');
  return s === '' ? null : s;
}

// ---- fetch 群 ----

// 席数一覧。bardb.tables 全件に analyticsdb.seat_capacities を JS で結合（未設定は seats=null）
async function fetchSeatCapacityRows() {
  const [tablesQ, capsQ] = await Promise.all([
    pos.query('SELECT id, name, table_type, is_active FROM tables ORDER BY id'),
    ana.query('SELECT table_id, seats, include_in_utilization FROM seat_capacities'),
  ]);
  const capMap = new Map(capsQ.rows.map((r) => [r.table_id, r]));
  return tablesQ.rows.map((t) => {
    const cap = capMap.get(t.id);
    return {
      table_id: t.id,
      table_name: t.name,
      table_type: t.table_type,
      is_active: t.is_active,
      seats: cap ? cap.seats : null,
      include_in_utilization: cap ? cap.include_in_utilization : null,
    };
  });
}

// レジ精算の月次一覧。現金売上のある営業日と精算記録のある営業日の和集合を返す
async function fetchClosingRows(month, B) {
  const { start, end } = bd.monthRange(month);
  const params = [start, end, bd.TZ, B];
  const [posQ, anaQ] = await Promise.all([
    pos.query(
      `SELECT ${DATE_B}::text AS date, COALESCE(SUM(o.cash_amount), 0)::float AS cash_sales
       FROM orders o
       WHERE ${PAID_FILTER} AND ${RANGE_W}
       GROUP BY 1`,
      params
    ),
    ana.query(
      `SELECT business_date::text AS date, open_cash, system_cash, counted_cash, cash_diff, memo
       FROM register_closings
       WHERE business_date BETWEEN $1 AND $2`,
      [start, end]
    ),
  ]);
  const cashMap = new Map(posQ.rows.map((r) => [r.date, r.cash_sales]));
  const recMap = new Map(anaQ.rows.map((r) => [r.date, r]));
  const dates = [...new Set([...cashMap.keys(), ...recMap.keys()])].sort();
  return dates.map((date) => {
    const rec = recMap.get(date);
    return {
      business_date: date,
      cash_sales: cashMap.get(date) ?? 0,
      open_cash: rec ? rec.open_cash : null,
      system_cash: rec ? rec.system_cash : null,
      counted_cash: rec ? rec.counted_cash : null,
      cash_diff: rec ? rec.cash_diff : null,
      memo: rec ? rec.memo : null,
    };
  });
}

// 1営業日の現金売上（PUT /register-closings/:date の system_cash 算出用）
async function fetchCashSales(date, B) {
  const { rows: [r] } = await pos.query(
    `SELECT COALESCE(SUM(o.cash_amount), 0)::float AS cash_sales
     FROM orders o
     WHERE ${PAID_FILTER} AND ${RANGE_W}`,
    [date, date, bd.TZ, B]
  );
  return Math.round(r.cash_sales);
}

// ---- エンドポイント ----

// GET /api/v1/seat-capacities
router.get('/seat-capacities', async (req, res, next) => {
  try {
    res.json(await withMeta({ rows: await fetchSeatCapacityRows() }));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/seat-capacities { rows: [{ table_id, seats, include_in_utilization }] }
// 一括 upsert（seats=null は未設定に戻す＝行削除）。table_name は bardb から採取して保存する
router.put('/seat-capacities', async (req, res, next) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (!Array.isArray(body.rows) || body.rows.length === 0) {
      throw badRequest('rows は1件以上の配列で指定してください');
    }
    if (body.rows.length > MAX_SEAT_ROWS) throw badRequest(`rows は ${MAX_SEAT_ROWS} 件以内で指定してください`);

    const { rows: tables } = await pos.query('SELECT id, name FROM tables');
    const nameMap = new Map(tables.map((t) => [t.id, t.name]));
    const seen = new Set();
    const parsed = body.rows.map((r, i) => {
      if (!r || typeof r !== 'object') throw badRequest(`rows[${i}] が不正です`);
      if (!Number.isInteger(r.table_id) || r.table_id <= 0) {
        throw badRequest(`rows[${i}].table_id は正の整数を指定してください`);
      }
      if (!nameMap.has(r.table_id)) throw badRequest(`存在しない table_id が含まれています: ${r.table_id}`);
      if (seen.has(r.table_id)) throw badRequest(`table_id が重複しています: ${r.table_id}`);
      seen.add(r.table_id);
      let seats = null;
      if (r.seats !== undefined && r.seats !== null && r.seats !== '') {
        if (!Number.isInteger(r.seats) || r.seats < 0 || r.seats > 1000) {
          throw badRequest(`rows[${i}].seats は 0〜1000 の整数か null を指定してください`);
        }
        seats = r.seats;
      }
      const include = r.include_in_utilization === undefined ? true : r.include_in_utilization;
      if (typeof include !== 'boolean') {
        throw badRequest(`rows[${i}].include_in_utilization は true / false を指定してください`);
      }
      return { tableId: r.table_id, tableName: nameMap.get(r.table_id), seats, include };
    });

    const client = await ana.pool.connect();
    try {
      await client.query('BEGIN');
      for (const p of parsed) {
        if (p.seats === null) {
          await client.query('DELETE FROM seat_capacities WHERE table_id = $1', [p.tableId]);
        } else {
          await client.query(
            `INSERT INTO seat_capacities (table_id, table_name, seats, include_in_utilization, updated_at)
             VALUES ($1, $2, $3, $4, NOW())
             ON CONFLICT (table_id) DO UPDATE
               SET table_name = EXCLUDED.table_name, seats = EXCLUDED.seats,
                   include_in_utilization = EXCLUDED.include_in_utilization, updated_at = NOW()`,
            [p.tableId, p.tableName, p.seats, p.include]
          );
        }
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    res.json(await withMeta({ rows: await fetchSeatCapacityRows() }));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/register-closings?month=YYYY-MM
router.get('/register-closings', async (req, res, next) => {
  try {
    const { dayMode, boundaryHour, B } = await sales.resolveModeBoundary(req.query);
    const month = req.query.month !== undefined
      ? String(req.query.month)
      : bd.dateOf(dayMode, new Date(), boundaryHour).slice(0, 7);
    const rows = await fetchClosingRows(month, B);
    res.json(await withMeta({ month, rows },
      { day_mode: dayMode, boundary_hour: boundaryHour, note: CLOSINGS_NOTE }));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/register-closings/:date { open_cash, counted_cash, memo }
// system_cash はサーバが open_cash + cash_sales（その営業日の SUM(cash_amount)）で算出して upsert する
router.put('/register-closings/:date', async (req, res, next) => {
  try {
    const date = bd.assertYmd(req.params.date, 'date');
    const { dayMode, boundaryHour, B } = await sales.resolveModeBoundary(req.query);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const openCash = parseCash(body.open_cash, 'open_cash');
    const countedCash = parseCash(body.counted_cash, 'counted_cash');
    const memo = parseMemo(body.memo);

    const cashSales = await fetchCashSales(date, B);
    const systemCash = openCash + cashSales;
    const { rows: [row] } = await ana.query(
      `INSERT INTO register_closings (business_date, open_cash, system_cash, counted_cash, memo, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (business_date) DO UPDATE
         SET open_cash = EXCLUDED.open_cash, system_cash = EXCLUDED.system_cash,
             counted_cash = EXCLUDED.counted_cash, memo = EXCLUDED.memo, updated_at = NOW()
       RETURNING business_date::text AS business_date, open_cash, system_cash, counted_cash, cash_diff, memo`,
      [date, openCash, systemCash, countedCash, memo]
    );
    res.json(await withMeta({ closing: { ...row, cash_sales: cashSales } },
      { day_mode: dayMode, boundary_hour: boundaryHour, note: CLOSINGS_NOTE }));
  } catch (err) {
    next(err);
  }
});

module.exports = router;

// CSV 出力(routes/export.js)から同一定義を再利用するための追加 export（sales.js と同じ流儀）
module.exports.fetchSeatCapacityRows = fetchSeatCapacityRows;
module.exports.fetchClosingRows = fetchClosingRows;
module.exports.fetchCashSales = fetchCashSales;
