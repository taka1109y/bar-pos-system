'use strict';
// /api/v1/staff・/api/v1/shifts — スタッフ・シフト入力 API（Phase 4）
// - 2つのリソースを1ファイルに並置し、index.js からは '/api/v1' にマウントする（inputs.js と同じ流儀）
// - すべて analyticsdb（ana.query = CRUD 可）。bardb へのアクセスは無い
// - hourly_wage_snapshot はサーバが決定する: staff_wage_history（effective_from <= business_date の最新）
//   → 無ければ staff.hourly_wage。時給変更（PATCH /staff/:id で hourly_wage 変更）時は
//   staff_wage_history に (staff_id, effective_from=今日の営業日, hourly_wage) を UPSERT する
// - work_minutes = (end_at - start_at) 分 - break_minutes（負にならないよう 0 で下限クランプ）
//   labor_cost = round(work_minutes / 60 × hourly_wage_snapshot)。どちらも保存せず SQL で都度計算する
// - business_date は「営業日」（store_settings.business_day_boundary_hour 基準）。
//   POST で未指定なら start_at から算出、PATCH で start_at 変更時は再算出する（snapshot は保持）
// - 分析(routes/pl.js・labor.js)と CSV 出力(routes/export.js)から再利用できるよう、fetch 群を末尾で追加 export する
const express = require('express');
const ana = require('../db/ana');
const bd = require('../lib/businessDay');
const { withMeta } = require('../lib/withMeta');
const expenses = require('./expenses'); // resolveMonthOrRange を再利用

const router = express.Router();

const EMPLOYMENT_TYPES = ['hourly', 'monthly', 'owner']; // 0001_init の CHECK と同値
const MAX_HOURLY_WAGE = 100_000;
const MAX_MONTHLY_SALARY = 10_000_000;
const MAX_BREAK_MINUTES = 1440;
const MAX_SHIFT_HOURS = 24;

// 実働分・人件費の SQL 式（shifts s 前提。labor_cost はシフト単位で round してから合計する）
const WORK_MINUTES_SQL =
  'GREATEST(0, ROUND(EXTRACT(EPOCH FROM (s.end_at - s.start_at)) / 60.0)::int - s.break_minutes)';
const LABOR_COST_SQL = `ROUND(${WORK_MINUTES_SQL} / 60.0 * s.hourly_wage_snapshot)`;

// シフト一覧の1行（スタッフ JOIN 済み）
const SHIFT_ROW_SELECT =
  `SELECT s.id, s.staff_id, st.name AS staff_name, st.employment_type,
          s.business_date::text AS business_date, s.start_at, s.end_at, s.break_minutes,
          s.hourly_wage_snapshot,
          ${WORK_MINUTES_SQL}::int AS work_minutes,
          ${LABOR_COST_SQL}::int AS labor_cost,
          s.memo
   FROM shifts s
   JOIN staff st ON st.id = s.staff_id`;

const SHIFTS_NOTE =
  'work_minutes = (end_at−start_at)分 − break_minutes（下限0）、labor_cost = round(work_minutes/60 × hourly_wage_snapshot)。' +
  'hourly_wage_snapshot は登録時にサーバが時給履歴から決定した値で、時給を後から変えても過去のシフトは変わりません';

const WAGE_HISTORY_NOTE =
  '時給を変更すると staff_wage_history に「今日の営業日から有効」として記録され、以降のシフトに反映されます';

function badRequest(error) {
  return { status: 400, error };
}

// ---- 入力検証（不正なら {status, error} を throw する既存流儀）----

function parseId(v, name = 'id') {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw badRequest(`${name} は正の整数を指定してください`);
  return n;
}

function parseName(v) {
  if (typeof v !== 'string' || v.trim() === '' || v.trim().length > 50) {
    throw badRequest('name は 1〜50 文字で指定してください');
  }
  return v.trim();
}

function parseEmploymentType(v) {
  if (!EMPLOYMENT_TYPES.includes(v)) {
    throw badRequest(`employment_type は ${EMPLOYMENT_TYPES.join(' / ')} のいずれかを指定してください`);
  }
  return v;
}

function parseHourlyWage(v) {
  if (!Number.isInteger(v) || v < 0 || v > MAX_HOURLY_WAGE) {
    throw badRequest(`hourly_wage は 0〜${MAX_HOURLY_WAGE} の整数を指定してください`);
  }
  return v;
}

function parseMonthlySalary(v) {
  if (!Number.isInteger(v) || v < 0 || v > MAX_MONTHLY_SALARY) {
    throw badRequest(`monthly_salary は 0〜${MAX_MONTHLY_SALARY} の整数を指定してください`);
  }
  return v;
}

function parseBool(v, name) {
  if (typeof v !== 'boolean') throw badRequest(`${name} は true / false を指定してください`);
  return v;
}

function parseBreakMinutes(v) {
  if (v === undefined || v === null) return 0;
  if (!Number.isInteger(v) || v < 0 || v > MAX_BREAK_MINUTES) {
    throw badRequest(`break_minutes は 0〜${MAX_BREAK_MINUTES} の整数を指定してください`);
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

// ISO 8601 タイムスタンプ → Date（不正・範囲外は 400）
function parseTimestamp(v, name) {
  if (typeof v !== 'string' || v.trim() === '') {
    throw badRequest(`${name} は ISO 8601 形式のタイムスタンプを指定してください`);
  }
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw badRequest(`${name} が不正です: ${v}`);
  const year = d.getUTCFullYear();
  if (year < 2000 || year > 2100) throw badRequest(`${name} は 2000〜2100 年の範囲で指定してください`);
  return d;
}

function assertShiftTimes(startDate, endDate) {
  if (endDate.getTime() <= startDate.getTime()) throw badRequest('end_at は start_at より後にしてください');
  if (endDate.getTime() - startDate.getTime() > MAX_SHIFT_HOURS * 3600 * 1000) {
    throw badRequest(`シフトは ${MAX_SHIFT_HOURS} 時間以内にしてください`);
  }
}

// ---- 設定・時給の解決 ----

// store_settings から Phase 4 で使う設定を読む（営業日境界・オーナー人件費・BEP固定費扱い）
async function loadLaborSettings() {
  const { rows: [row] } = await ana.query(
    'SELECT business_day_boundary_hour, include_owner_labor, labor_is_fixed_for_bep FROM store_settings WHERE id = 1'
  );
  if (!row) throw new Error('store_settings が初期化されていません');
  return row;
}

// business_date 時点の時給（staff_wage_history 最新 → staff.hourly_wage）。staff が居なければ null
async function resolveWage(client, staffId, businessDate) {
  const { rows: [row] } = await client.query(
    `SELECT COALESCE(
       (SELECT hourly_wage FROM staff_wage_history
        WHERE staff_id = $1 AND effective_from <= $2
        ORDER BY effective_from DESC LIMIT 1),
       (SELECT hourly_wage FROM staff WHERE id = $1)
     )::int AS wage`,
    [staffId, businessDate]
  );
  return row && row.wage !== null ? row.wage : null;
}

// ---- fetch 群 ----

// スタッフ一覧（current_wage = today 時点の時給、shift_count = 全期間のシフト数）
async function fetchStaffRows(today) {
  const { rows } = await ana.query(
    `SELECT s.id, s.name, s.employment_type, s.hourly_wage, s.monthly_salary, s.is_active,
            COALESCE(w.hourly_wage, s.hourly_wage)::int AS current_wage,
            (SELECT COUNT(*)::int FROM shifts sh WHERE sh.staff_id = s.id) AS shift_count
     FROM staff s
     LEFT JOIN LATERAL (
       SELECT hourly_wage FROM staff_wage_history
       WHERE staff_id = s.id AND effective_from <= $1
       ORDER BY effective_from DESC LIMIT 1
     ) w ON TRUE
     ORDER BY s.id`,
    [today]
  );
  return rows;
}

// シフト一覧（期間指定・開始時刻順）
async function fetchShiftRows(start, end) {
  const { rows } = await ana.query(
    `${SHIFT_ROW_SELECT}
     WHERE s.business_date BETWEEN $1 AND $2
     ORDER BY s.start_at, s.id`,
    [start, end]
  );
  return rows;
}

// 営業日別の労働時間・人件費（pl.js の labor_shift 用。includeOwner=false で owner を除外）
async function fetchLaborDaily(start, end, includeOwner) {
  const ownerFilter = includeOwner ? '' : ` AND st.employment_type <> 'owner'`;
  const { rows } = await ana.query(
    `SELECT s.business_date::text AS business_date,
            COALESCE(SUM(${WORK_MINUTES_SQL}), 0)::float AS work_minutes,
            COALESCE(SUM(${LABOR_COST_SQL}), 0)::float AS labor_cost
     FROM shifts s
     JOIN staff st ON st.id = s.staff_id
     WHERE s.business_date BETWEEN $1 AND $2${ownerFilter}
     GROUP BY 1`,
    [start, end]
  );
  return rows;
}

// スタッフ別の労働時間・人件費（labor.js の by_staff 用）
async function fetchLaborByStaff(start, end, includeOwner) {
  const ownerFilter = includeOwner ? '' : ` AND st.employment_type <> 'owner'`;
  const { rows } = await ana.query(
    `SELECT s.staff_id, st.name,
            COALESCE(SUM(${WORK_MINUTES_SQL}), 0)::float AS work_minutes,
            COALESCE(SUM(${LABOR_COST_SQL}), 0)::float AS labor_cost,
            COUNT(*)::int AS shift_count
     FROM shifts s
     JOIN staff st ON st.id = s.staff_id
     WHERE s.business_date BETWEEN $1 AND $2${ownerFilter}
     GROUP BY s.staff_id, st.name
     ORDER BY s.staff_id`,
    [start, end]
  );
  return rows;
}

async function fetchShiftById(id) {
  const { rows: [row] } = await ana.query(`${SHIFT_ROW_SELECT} WHERE s.id = $1`, [id]);
  return row || null;
}

// ---- スタッフ ----

// GET /api/v1/staff
router.get('/staff', async (req, res, next) => {
  try {
    const settings = await loadLaborSettings();
    const today = bd.todayBusiness(settings.business_day_boundary_hour);
    res.json(await withMeta({ rows: await fetchStaffRows(today) }, { note: WAGE_HISTORY_NOTE }));
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/staff { name, employment_type, hourly_wage, monthly_salary }
router.post('/staff', async (req, res, next) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const name = parseName(body.name);
    const employmentType = body.employment_type === undefined ? 'hourly' : parseEmploymentType(body.employment_type);
    const hourlyWage = body.hourly_wage === undefined ? 0 : parseHourlyWage(body.hourly_wage);
    const monthlySalary = body.monthly_salary === undefined ? 0 : parseMonthlySalary(body.monthly_salary);
    const { rows: [row] } = await ana.query(
      `INSERT INTO staff (name, employment_type, hourly_wage, monthly_salary)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, employment_type, hourly_wage, monthly_salary, is_active`,
      [name, employmentType, hourlyWage, monthlySalary]
    );
    res.status(201).json(await withMeta({ staff: { ...row, current_wage: row.hourly_wage, shift_count: 0 } }));
  } catch (err) {
    next(err);
  }
});

const STAFF_PATCH_ALLOWED = {
  name: parseName,
  employment_type: parseEmploymentType,
  hourly_wage: parseHourlyWage,
  monthly_salary: parseMonthlySalary,
  is_active: (v) => parseBool(v, 'is_active'),
};

// PATCH /api/v1/staff/:id（部分更新。hourly_wage 変更時は staff_wage_history に UPSERT）
router.patch('/staff/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const updates = {};
    for (const [key, value] of Object.entries(body)) {
      if (!(key in STAFF_PATCH_ALLOWED)) continue; // 許可外の列は無視
      updates[key] = STAFF_PATCH_ALLOWED[key](value);
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: '更新可能な項目がありません', allowed: Object.keys(STAFF_PATCH_ALLOWED) });
    }
    const settings = await loadLaborSettings();
    const today = bd.todayBusiness(settings.business_day_boundary_hour);

    const client = await ana.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [current] } = await client.query(
        'SELECT id, hourly_wage FROM staff WHERE id = $1 FOR UPDATE', [id]
      );
      if (!current) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: `スタッフが見つかりません: id=${id}` });
      }
      const keys = Object.keys(updates);
      const sets = keys.map((k, i) => `${k} = $${i + 2}`);
      await client.query(
        `UPDATE staff SET ${sets.join(', ')} WHERE id = $1`,
        [id, ...keys.map((k) => updates[k])]
      );
      // 時給変更時は「今日の営業日から有効」として履歴に UPSERT（過去シフトの snapshot は変わらない）
      if ('hourly_wage' in updates && updates.hourly_wage !== current.hourly_wage) {
        await client.query(
          `INSERT INTO staff_wage_history (staff_id, effective_from, hourly_wage)
           VALUES ($1, $2, $3)
           ON CONFLICT (staff_id, effective_from) DO UPDATE SET hourly_wage = EXCLUDED.hourly_wage`,
          [id, today, updates.hourly_wage]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    const rows = await fetchStaffRows(today);
    const staff = rows.find((r) => r.id === id);
    res.json(await withMeta({ staff }, { note: WAGE_HISTORY_NOTE }));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/staff/:id（シフト紐付きありは 409。無効化は PATCH is_active=false で）
router.delete('/staff/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const { rows: [used] } = await ana.query(
      'SELECT COUNT(*)::int AS shift_count FROM shifts WHERE staff_id = $1', [id]
    );
    if (used.shift_count > 0) {
      return res.status(409).json({
        error: `シフトのあるスタッフは削除できません（シフト ${used.shift_count} 件）。` +
          '無効化する場合は PATCH で is_active=false にしてください',
        shift_count: used.shift_count,
      });
    }
    // staff_wage_history は ON DELETE CASCADE で一緒に消える
    const { rowCount } = await ana.query('DELETE FROM staff WHERE id = $1', [id]);
    if (rowCount === 0) return res.status(404).json({ error: `スタッフが見つかりません: id=${id}` });
    res.json(await withMeta({ deleted: true, id }));
  } catch (err) {
    next(err);
  }
});

// ---- シフト ----

// GET /api/v1/shifts?month=YYYY-MM または start&end
router.get('/shifts', async (req, res, next) => {
  try {
    const { month, start, end } = expenses.resolveMonthOrRange(req.query);
    const rows = await fetchShiftRows(start, end);
    res.json(await withMeta({ ...(month ? { month } : {}), start, end, rows }, { note: SHIFTS_NOTE }));
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/shifts { staff_id, business_date(任意), start_at, end_at, break_minutes, memo }
// business_date 未指定なら start_at の営業日。hourly_wage_snapshot はサーバが時給履歴から決定する
router.post('/shifts', async (req, res, next) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const staffId = parseId(body.staff_id, 'staff_id');
    const startAt = parseTimestamp(body.start_at, 'start_at');
    const endAt = parseTimestamp(body.end_at, 'end_at');
    assertShiftTimes(startAt, endAt);
    const breakMinutes = parseBreakMinutes(body.break_minutes);
    const memo = parseMemo(body.memo);
    const settings = await loadLaborSettings();
    const businessDate = body.business_date !== undefined
      ? bd.assertYmd(body.business_date, 'business_date')
      : bd.businessDateOf(startAt, settings.business_day_boundary_hour);

    const wage = await resolveWage(ana, staffId, businessDate);
    if (wage === null) throw badRequest(`存在しない staff_id です: ${staffId}`);

    const { rows: [ins] } = await ana.query(
      `INSERT INTO shifts (staff_id, business_date, start_at, end_at, break_minutes, hourly_wage_snapshot, memo)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [staffId, businessDate, startAt.toISOString(), endAt.toISOString(), breakMinutes, wage, memo]
    );
    res.status(201).json(await withMeta({ shift: await fetchShiftById(ins.id) }, { note: SHIFTS_NOTE }));
  } catch (err) {
    if (err.code === '23505') { // unique_violation (staff_id, start_at)
      return res.status(409).json({ error: '同じスタッフ・同じ開始時刻のシフトが既にあります' });
    }
    next(err);
  }
});

// PATCH /api/v1/shifts/:id { start_at, end_at, break_minutes, memo, business_date }
// 時刻変更時は business_date を再計算する（明示指定があればそちらを優先）。hourly_wage_snapshot は保持
router.patch('/shifts/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const current = await fetchShiftById(id);
    if (!current) return res.status(404).json({ error: `シフトが見つかりません: id=${id}` });

    const hasStart = body.start_at !== undefined;
    const hasEnd = body.end_at !== undefined;
    const hasBreak = body.break_minutes !== undefined;
    const hasMemo = body.memo !== undefined;
    const hasDate = body.business_date !== undefined;
    if (!hasStart && !hasEnd && !hasBreak && !hasMemo && !hasDate) {
      return res.status(400).json({
        error: '更新可能な項目がありません',
        allowed: ['start_at', 'end_at', 'break_minutes', 'memo', 'business_date'],
      });
    }
    const startAt = hasStart ? parseTimestamp(body.start_at, 'start_at') : new Date(current.start_at);
    const endAt = hasEnd ? parseTimestamp(body.end_at, 'end_at') : new Date(current.end_at);
    assertShiftTimes(startAt, endAt);
    const breakMinutes = hasBreak ? parseBreakMinutes(body.break_minutes) : current.break_minutes;
    const memo = hasMemo ? parseMemo(body.memo) : current.memo;
    let businessDate = current.business_date;
    if (hasDate) {
      businessDate = bd.assertYmd(body.business_date, 'business_date');
    } else if (hasStart) {
      const settings = await loadLaborSettings();
      businessDate = bd.businessDateOf(startAt, settings.business_day_boundary_hour);
    }

    await ana.query(
      `UPDATE shifts SET business_date = $2, start_at = $3, end_at = $4, break_minutes = $5, memo = $6
       WHERE id = $1`,
      [id, businessDate, startAt.toISOString(), endAt.toISOString(), breakMinutes, memo]
    );
    res.json(await withMeta({ shift: await fetchShiftById(id) }, { note: SHIFTS_NOTE }));
  } catch (err) {
    if (err.code === '23505') { // unique_violation (staff_id, start_at)
      return res.status(409).json({ error: '同じスタッフ・同じ開始時刻のシフトが既にあります' });
    }
    next(err);
  }
});

// DELETE /api/v1/shifts/:id
router.delete('/shifts/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const { rowCount } = await ana.query('DELETE FROM shifts WHERE id = $1', [id]);
    if (rowCount === 0) return res.status(404).json({ error: `シフトが見つかりません: id=${id}` });
    res.json(await withMeta({ deleted: true, id }));
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/shifts/copy-week { from_week_start: "YYYY-MM-DD", to_week_start: "YYYY-MM-DD" }
// from 週（7日分）のシフトを日数差で平行移動して複製する。既存 (staff_id, start_at) はスキップ（冪等）。
// hourly_wage_snapshot は複製先の営業日で改めて解決する（時給改定をまたぐ複製に対応）
router.post('/shifts/copy-week', async (req, res, next) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const fromStart = bd.assertYmd(body.from_week_start, 'from_week_start');
    const toStart = bd.assertYmd(body.to_week_start, 'to_week_start');
    const diff = bd.diffDays(fromStart, toStart);
    if (diff === 0) throw badRequest('from_week_start と to_week_start が同じ週です');

    const source = await fetchShiftRows(fromStart, bd.addDays(fromStart, 6));
    let inserted = 0;
    const client = await ana.pool.connect();
    try {
      await client.query('BEGIN');
      for (const s of source) {
        const newDate = bd.addDays(s.business_date, diff);
        const wage = await resolveWage(client, s.staff_id, newDate);
        if (wage === null) continue; // スタッフが消えている場合はスキップ（FK 上は起きないが防御）
        const { rowCount } = await client.query(
          `INSERT INTO shifts (staff_id, business_date, start_at, end_at, break_minutes, hourly_wage_snapshot, memo)
           VALUES ($1, $2, $3::timestamptz + make_interval(days => $4::int), $5::timestamptz + make_interval(days => $4::int), $6, $7, $8)
           ON CONFLICT (staff_id, start_at) DO NOTHING`,
          [s.staff_id, newDate, s.start_at, diff, s.end_at, s.break_minutes, wage, s.memo]
        );
        inserted += rowCount;
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    res.json(await withMeta({
      from_week_start: fromStart,
      to_week_start: toStart,
      inserted,
      skipped: source.length - inserted,
    }));
  } catch (err) {
    next(err);
  }
});

module.exports = router;

// 分析(routes/pl.js・labor.js)と CSV 出力(routes/export.js)から同一定義を再利用するための追加 export
module.exports.loadLaborSettings = loadLaborSettings;
module.exports.fetchStaffRows = fetchStaffRows;
module.exports.fetchShiftRows = fetchShiftRows;
module.exports.fetchLaborDaily = fetchLaborDaily;
module.exports.fetchLaborByStaff = fetchLaborByStaff;
