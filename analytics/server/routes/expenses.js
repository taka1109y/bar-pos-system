'use strict';
// /api/v1/expense-categories・/api/v1/expenses・/api/v1/recurring-expenses — 経費入力 API（Phase 4）
// - 3つのリソースを1ファイルに並置し、index.js からは '/api/v1' にマウントする（inputs.js と同じ流儀）
// - すべて analyticsdb（ana.query = CRUD 可）。bardb へのアクセスは無い
// - 経費科目（expense_categories）は cost_type（fixed/variable）と pnl_line（P&L 行）を持ち、
//   pl.js（月次P&L・損益分岐点）の集計軸になる。使用中（expenses / recurring_expenses 紐付きあり）の削除は 409
// - CSV 取込（POST /expenses/import-csv）は全行検証し、全件成功時のみ一括 INSERT（トランザクション）
// - 定期経費の展開（POST /recurring-expenses/generate）は (recurrence_id, period_month) の
//   部分ユニークインデックス（0001_init）への ON CONFLICT DO NOTHING で冪等
// - CSV 出力(routes/export.js)から再利用できるよう、fetch 群を末尾で追加 export する
const express = require('express');
const ana = require('../db/ana');
const bd = require('../lib/businessDay');
const { withMeta } = require('../lib/withMeta');

const router = express.Router();

const COST_TYPES = ['fixed', 'variable'];                // 0001_init の CHECK と同値
const PNL_LINES = ['purchase', 'labor', 'rent', 'utilities', 'supplies', 'marketing', 'fees', 'other'];
const ALLOC_METHODS = ['date', 'month_even'];

const CAT_COLUMNS = 'id, code, name, cost_type, pnl_line, sort_order, is_active';

// 経費一覧の1行（科目 JOIN 済み）。amount は INTEGER 列だが ::float で数値化を統一する
const EXPENSE_ROW_SELECT =
  `SELECT e.id, e.expense_date::text AS expense_date, e.category_id,
          c.code AS category_code, c.name AS category_name, c.cost_type, c.pnl_line,
          e.amount::float AS amount, e.tax_included, e.alloc_method, e.vendor, e.memo, e.recurrence_id
   FROM expenses e
   JOIN expense_categories c ON c.id = e.category_id`;

const RECURRING_ROW_SELECT =
  `SELECT r.id, r.category_id, c.code AS category_code, c.name AS category_name, c.cost_type, c.pnl_line,
          r.amount::float AS amount, r.day_of_month, r.alloc_method, r.vendor, r.memo, r.is_active
   FROM recurring_expenses r
   JOIN expense_categories c ON c.id = r.category_id`;

const MAX_AMOUNT = 100_000_000;
const MAX_RANGE_DAYS = 3700;        // sales.js と同じ上限（約10年）
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;              // Phase 4 契約
const MAX_CSV_CHARS = 500_000;
const MAX_CSV_ROWS = 1000;

const EXPENSES_NOTE =
  'total_count / total_amount は limit・offset を除いた絞り込み全体の件数・金額合計';

function badRequest(error) {
  return { status: 400, error };
}

// ---- 入力検証（不正なら {status, error} を throw する既存流儀）----

function parseId(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw badRequest('id は正の整数を指定してください');
  return n;
}

function parseCode(v) {
  if (typeof v !== 'string' || !/^[a-z0-9_-]{1,32}$/.test(v)) {
    throw badRequest('code は英小文字・数字・ハイフン・アンダースコア 1〜32 文字で指定してください');
  }
  return v;
}

function parseName(v) {
  if (typeof v !== 'string' || v.trim() === '' || v.trim().length > 50) {
    throw badRequest('name は 1〜50 文字で指定してください');
  }
  return v.trim();
}

function parseCostType(v) {
  if (!COST_TYPES.includes(v)) throw badRequest(`cost_type は ${COST_TYPES.join(' / ')} のいずれかを指定してください`);
  return v;
}

function parsePnlLine(v) {
  if (!PNL_LINES.includes(v)) throw badRequest(`pnl_line は ${PNL_LINES.join(' / ')} のいずれかを指定してください`);
  return v;
}

function parseSortOrder(v) {
  if (v === undefined || v === null) return 0;
  if (!Number.isInteger(v) || v < 0 || v > 9999) throw badRequest('sort_order は 0〜9999 の整数を指定してください');
  return v;
}

function parseBool(v, name) {
  if (typeof v !== 'boolean') throw badRequest(`${name} は true / false を指定してください`);
  return v;
}

function parseAmount(v) {
  if (!Number.isInteger(v) || v < 0 || v > MAX_AMOUNT) {
    throw badRequest(`amount は 0〜${MAX_AMOUNT} の整数を指定してください`);
  }
  return v;
}

function parseAllocMethod(v) {
  if (v === undefined || v === null || v === '') return 'date';
  if (!ALLOC_METHODS.includes(v)) throw badRequest(`alloc_method は ${ALLOC_METHODS.join(' / ')} のいずれかを指定してください`);
  return v;
}

function parseText(v, name, maxLen) {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw badRequest(`${name} は文字列で指定してください`);
  const s = v.trim();
  if (s.length > maxLen) throw badRequest(`${name} は ${maxLen} 文字以内で指定してください`);
  return s === '' ? null : s;
}

function parseDayOfMonth(v) {
  if (v === undefined || v === null) return 1;
  if (!Number.isInteger(v) || v < 1 || v > 28) throw badRequest('day_of_month は 1〜28 の整数を指定してください');
  return v;
}

// month=YYYY-MM または start&end を {month, start, end} に解決する（どちらも無ければ今月）
// staff.js（シフト一覧）と export.js（CSV）からも再利用する
function resolveMonthOrRange(q) {
  if (q.month !== undefined) {
    return bd.monthRange(String(q.month));
  }
  if (q.start !== undefined || q.end !== undefined) {
    const start = bd.assertYmd(q.start, 'start');
    const end = bd.assertYmd(q.end, 'end');
    if (start > end) throw badRequest('start は end 以前の日付を指定してください');
    if (bd.diffDays(start, end) + 1 > MAX_RANGE_DAYS) throw badRequest(`期間は最大 ${MAX_RANGE_DAYS} 日までです`);
    return { month: null, start, end };
  }
  return bd.monthRange(bd.todayCalendar().slice(0, 7));
}

async function categoryExists(id) {
  const { rows } = await ana.query('SELECT id FROM expense_categories WHERE id = $1', [id]);
  return rows.length > 0;
}

// ---- fetch 群 ----

// 科目一覧（expense_count = expenses での使用件数）
async function fetchCategoryRows() {
  const { rows } = await ana.query(
    `SELECT c.id, c.code, c.name, c.cost_type, c.pnl_line, c.sort_order, c.is_active,
            COUNT(e.id)::int AS expense_count
     FROM expense_categories c
     LEFT JOIN expenses e ON e.category_id = c.id
     GROUP BY c.id, c.code, c.name, c.cost_type, c.pnl_line, c.sort_order, c.is_active
     ORDER BY c.sort_order, c.id`
  );
  return rows;
}

// 経費一覧（科目 JOIN 済み・expense_date 昇順）。limit=null で全件（CSV 出力用）
async function fetchExpenseRows(start, end, { categoryId = null, limit = null, offset = 0 } = {}) {
  const params = [start, end];
  let where = 'WHERE e.expense_date BETWEEN $1 AND $2';
  if (categoryId !== null) {
    params.push(categoryId);
    where += ` AND e.category_id = $${params.length}`;
  }
  let page = '';
  if (limit !== null) {
    params.push(limit, offset);
    page = ` LIMIT $${params.length - 1} OFFSET $${params.length}`;
  }
  const [listQ, aggQ] = await Promise.all([
    ana.query(`${EXPENSE_ROW_SELECT} ${where} ORDER BY e.expense_date, e.id${page}`, params),
    ana.query(
      `SELECT COUNT(*)::int AS total_count, COALESCE(SUM(e.amount), 0)::float AS total_amount
       FROM expenses e ${where}`,
      params.slice(0, categoryId !== null ? 3 : 2)
    ),
  ]);
  return { rows: listQ.rows, total_count: aggQ.rows[0].total_count, total_amount: aggQ.rows[0].total_amount };
}

// 定期経費一覧
async function fetchRecurringRows() {
  const { rows } = await ana.query(`${RECURRING_ROW_SELECT} ORDER BY r.id`);
  return rows;
}

// ---- 経費科目 ----

// GET /api/v1/expense-categories
router.get('/expense-categories', async (req, res, next) => {
  try {
    res.json(await withMeta({ rows: await fetchCategoryRows() }));
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/expense-categories { code, name, cost_type, pnl_line, sort_order, is_active }
router.post('/expense-categories', async (req, res, next) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const code = parseCode(body.code);
    const name = parseName(body.name);
    const costType = parseCostType(body.cost_type);
    const pnlLine = parsePnlLine(body.pnl_line);
    const sortOrder = parseSortOrder(body.sort_order);
    const isActive = body.is_active === undefined ? true : parseBool(body.is_active, 'is_active');
    const { rows: [row] } = await ana.query(
      `INSERT INTO expense_categories (code, name, cost_type, pnl_line, sort_order, is_active)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${CAT_COLUMNS}`,
      [code, name, costType, pnlLine, sortOrder, isActive]
    );
    res.status(201).json(await withMeta({ category: { ...row, expense_count: 0 } }));
  } catch (err) {
    if (err.code === '23505') { // unique_violation
      return res.status(409).json({ error: '同じ code の科目が既にあります' });
    }
    next(err);
  }
});

// PATCH で更新を許可する列とバリデータ（settings.js と同じ流儀）
const CAT_PATCH_ALLOWED = {
  code: parseCode,
  name: parseName,
  cost_type: parseCostType,
  pnl_line: parsePnlLine,
  sort_order: (v) => parseSortOrder(v),
  is_active: (v) => parseBool(v, 'is_active'),
};

// PATCH /api/v1/expense-categories/:id（部分更新。無効化は is_active=false）
router.patch('/expense-categories/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const updates = {};
    for (const [key, value] of Object.entries(body)) {
      if (!(key in CAT_PATCH_ALLOWED)) continue; // 許可外の列は無視
      updates[key] = CAT_PATCH_ALLOWED[key](value);
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: '更新可能な項目がありません', allowed: Object.keys(CAT_PATCH_ALLOWED) });
    }
    const keys = Object.keys(updates);
    const sets = keys.map((k, i) => `${k} = $${i + 2}`);
    const { rows: [row] } = await ana.query(
      `UPDATE expense_categories SET ${sets.join(', ')} WHERE id = $1 RETURNING ${CAT_COLUMNS}`,
      [id, ...keys.map((k) => updates[k])]
    );
    if (!row) return res.status(404).json({ error: `科目が見つかりません: id=${id}` });
    res.json(await withMeta({ category: row }));
  } catch (err) {
    if (err.code === '23505') { // unique_violation
      return res.status(409).json({ error: '同じ code の科目が既にあります' });
    }
    next(err);
  }
});

// DELETE /api/v1/expense-categories/:id（経費・定期経費の紐付きありは 409）
router.delete('/expense-categories/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const { rows: [used] } = await ana.query(
      `SELECT (SELECT COUNT(*)::int FROM expenses WHERE category_id = $1)           AS expense_count,
              (SELECT COUNT(*)::int FROM recurring_expenses WHERE category_id = $1) AS recurring_count`,
      [id]
    );
    if (used.expense_count > 0 || used.recurring_count > 0) {
      return res.status(409).json({
        error: `使用中の科目は削除できません（経費 ${used.expense_count} 件・定期経費 ${used.recurring_count} 件）。` +
          '無効化する場合は PATCH で is_active=false にしてください',
        expense_count: used.expense_count,
        recurring_count: used.recurring_count,
      });
    }
    const { rowCount } = await ana.query('DELETE FROM expense_categories WHERE id = $1', [id]);
    if (rowCount === 0) return res.status(404).json({ error: `科目が見つかりません: id=${id}` });
    res.json(await withMeta({ deleted: true, id }));
  } catch (err) {
    next(err);
  }
});

// ---- 経費 ----

// GET /api/v1/expenses?month=YYYY-MM または start&end（+category_id, limit<=500, offset）
router.get('/expenses', async (req, res, next) => {
  try {
    const { start, end } = resolveMonthOrRange(req.query);
    const categoryId = req.query.category_id !== undefined ? parseId(req.query.category_id) : null;
    let limit = DEFAULT_LIMIT;
    if (req.query.limit !== undefined) {
      const n = Number(req.query.limit);
      if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) {
        throw badRequest(`limit は 1〜${MAX_LIMIT} の整数を指定してください`);
      }
      limit = n;
    }
    let offset = 0;
    if (req.query.offset !== undefined) {
      const n = Number(req.query.offset);
      if (!Number.isInteger(n) || n < 0) throw badRequest('offset は 0 以上の整数を指定してください');
      offset = n;
    }
    const data = await fetchExpenseRows(start, end, { categoryId, limit, offset });
    res.json(await withMeta({ start, end, ...data, limit, offset }, { note: EXPENSES_NOTE }));
  } catch (err) {
    next(err);
  }
});

// 1件を科目 JOIN 済みで再取得（INSERT/UPDATE 後の応答用）
async function fetchExpenseById(id) {
  const { rows: [row] } = await ana.query(`${EXPENSE_ROW_SELECT} WHERE e.id = $1`, [id]);
  return row || null;
}

// POST /api/v1/expenses { expense_date, category_id, amount, tax_included, alloc_method, vendor, memo }
router.post('/expenses', async (req, res, next) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const expenseDate = bd.assertYmd(body.expense_date, 'expense_date');
    const categoryId = parseId(body.category_id);
    const amount = parseAmount(body.amount);
    const taxIncluded = body.tax_included === undefined ? true : parseBool(body.tax_included, 'tax_included');
    const allocMethod = parseAllocMethod(body.alloc_method);
    const vendor = parseText(body.vendor, 'vendor', 100);
    const memo = parseText(body.memo, 'memo', 500);
    if (!(await categoryExists(categoryId))) {
      throw badRequest(`存在しない category_id です: ${categoryId}`);
    }
    const { rows: [ins] } = await ana.query(
      `INSERT INTO expenses (expense_date, category_id, amount, tax_included, alloc_method, vendor, memo)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [expenseDate, categoryId, amount, taxIncluded, allocMethod, vendor, memo]
    );
    res.status(201).json(await withMeta({ expense: await fetchExpenseById(ins.id) }));
  } catch (err) {
    next(err);
  }
});

const EXPENSE_PATCH_ALLOWED = {
  expense_date: (v) => bd.assertYmd(v, 'expense_date'),
  category_id: parseId,
  amount: parseAmount,
  tax_included: (v) => parseBool(v, 'tax_included'),
  alloc_method: parseAllocMethod,
  vendor: (v) => parseText(v, 'vendor', 100),
  memo: (v) => parseText(v, 'memo', 500),
};

// PATCH /api/v1/expenses/:id（部分更新）
router.patch('/expenses/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const updates = {};
    for (const [key, value] of Object.entries(body)) {
      if (!(key in EXPENSE_PATCH_ALLOWED)) continue; // 許可外の列は無視
      updates[key] = EXPENSE_PATCH_ALLOWED[key](value);
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: '更新可能な項目がありません', allowed: Object.keys(EXPENSE_PATCH_ALLOWED) });
    }
    if ('category_id' in updates && !(await categoryExists(updates.category_id))) {
      throw badRequest(`存在しない category_id です: ${updates.category_id}`);
    }
    const keys = Object.keys(updates);
    const sets = keys.map((k, i) => `${k} = $${i + 2}`);
    const { rowCount } = await ana.query(
      `UPDATE expenses SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1`,
      [id, ...keys.map((k) => updates[k])]
    );
    if (rowCount === 0) return res.status(404).json({ error: `経費が見つかりません: id=${id}` });
    res.json(await withMeta({ expense: await fetchExpenseById(id) }));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/expenses/:id
router.delete('/expenses/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const { rowCount } = await ana.query('DELETE FROM expenses WHERE id = $1', [id]);
    if (rowCount === 0) return res.status(404).json({ error: `経費が見つかりません: id=${id}` });
    res.json(await withMeta({ deleted: true, id }));
  } catch (err) {
    next(err);
  }
});

// ---- CSV 取込 ----

// CSV 1行をフィールド配列に分解する（ダブルクォート囲み・"" エスケープ対応の最小実装）
function splitCsvLine(line) {
  const fields = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQuote = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"' && cur === '') {
      inQuote = true;
    } else if (ch === ',') {
      fields.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields.map((f) => f.trim());
}

// POST /api/v1/expenses/import-csv { csv: "date,category_code,amount,vendor,memo\n..." }
// 全行検証し、全件成功時のみ一括 INSERT（トランザクション）。失敗時は { error, line, detail } で 400
router.post('/expenses/import-csv', async (req, res, next) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (typeof body.csv !== 'string' || body.csv.trim() === '') {
      throw badRequest('csv は "date,category_code,amount,vendor,memo" 形式の文字列で指定してください');
    }
    if (body.csv.length > MAX_CSV_CHARS) throw badRequest(`csv は ${MAX_CSV_CHARS} 文字以内で指定してください`);

    const { rows: cats } = await ana.query('SELECT id, code FROM expense_categories');
    const codeMap = new Map(cats.map((c) => [c.code, c.id]));

    const lines = body.csv.split(/\r?\n/);
    const parsed = [];
    const fail = (line, detail) => {
      throw { status: 400, error: `CSV の ${line} 行目が不正です`, line, detail };
    };
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const lineNo = i + 1;
      if (raw.trim() === '') continue; // 空行は無視
      const fields = splitCsvLine(raw);
      // ヘッダ行（date,category_code,...）は読み飛ばす
      if (lineNo === 1 && /^date$/i.test(fields[0] || '')) continue;
      if (fields.length < 3 || fields.length > 5) {
        fail(lineNo, 'date,category_code,amount[,vendor[,memo]] の3〜5列で指定してください');
      }
      const [dateStr, code, amountStr, vendorStr, memoStr] = fields;
      let date;
      try {
        date = bd.assertYmd(dateStr, 'date');
      } catch (e) {
        fail(lineNo, `date が不正です: ${dateStr}（YYYY-MM-DD 形式の実在する日付）`);
      }
      const categoryId = codeMap.get(code);
      if (!categoryId) fail(lineNo, `存在しない category_code です: ${code}`);
      const amount = Number(amountStr);
      if (!Number.isInteger(amount) || amount < 0 || amount > MAX_AMOUNT) {
        fail(lineNo, `amount は 0〜${MAX_AMOUNT} の整数を指定してください: ${amountStr}`);
      }
      let vendor = null;
      let memo = null;
      try {
        vendor = parseText(vendorStr, 'vendor', 100);
        memo = parseText(memoStr, 'memo', 500);
      } catch (e) {
        fail(lineNo, e.error || String(e));
      }
      parsed.push({ date, categoryId, amount, vendor, memo });
      if (parsed.length > MAX_CSV_ROWS) throw badRequest(`一度に取込できるのは ${MAX_CSV_ROWS} 行までです`);
    }
    if (parsed.length === 0) throw badRequest('取込対象の行がありません');

    const client = await ana.pool.connect();
    try {
      await client.query('BEGIN');
      for (const p of parsed) {
        await client.query(
          `INSERT INTO expenses (expense_date, category_id, amount, vendor, memo)
           VALUES ($1, $2, $3, $4, $5)`,
          [p.date, p.categoryId, p.amount, p.vendor, p.memo]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    res.status(201).json(await withMeta({ inserted: parsed.length }));
  } catch (err) {
    next(err);
  }
});

// ---- 定期経費 ----

// GET /api/v1/recurring-expenses
router.get('/recurring-expenses', async (req, res, next) => {
  try {
    res.json(await withMeta({ rows: await fetchRecurringRows() }));
  } catch (err) {
    next(err);
  }
});

async function fetchRecurringById(id) {
  const { rows: [row] } = await ana.query(`${RECURRING_ROW_SELECT} WHERE r.id = $1`, [id]);
  return row || null;
}

// POST /api/v1/recurring-expenses { category_id, amount, day_of_month, alloc_method, vendor, memo, is_active }
router.post('/recurring-expenses', async (req, res, next) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const categoryId = parseId(body.category_id);
    const amount = parseAmount(body.amount);
    const dayOfMonth = parseDayOfMonth(body.day_of_month);
    const allocMethod = body.alloc_method === undefined || body.alloc_method === null || body.alloc_method === ''
      ? 'month_even'
      : parseAllocMethod(body.alloc_method);
    const vendor = parseText(body.vendor, 'vendor', 100);
    const memo = parseText(body.memo, 'memo', 500);
    const isActive = body.is_active === undefined ? true : parseBool(body.is_active, 'is_active');
    if (!(await categoryExists(categoryId))) {
      throw badRequest(`存在しない category_id です: ${categoryId}`);
    }
    const { rows: [ins] } = await ana.query(
      `INSERT INTO recurring_expenses (category_id, amount, day_of_month, alloc_method, vendor, memo, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [categoryId, amount, dayOfMonth, allocMethod, vendor, memo, isActive]
    );
    res.status(201).json(await withMeta({ recurring_expense: await fetchRecurringById(ins.id) }));
  } catch (err) {
    next(err);
  }
});

const RECURRING_PATCH_ALLOWED = {
  category_id: parseId,
  amount: parseAmount,
  day_of_month: parseDayOfMonth,
  alloc_method: parseAllocMethod,
  vendor: (v) => parseText(v, 'vendor', 100),
  memo: (v) => parseText(v, 'memo', 500),
  is_active: (v) => parseBool(v, 'is_active'),
};

// PATCH /api/v1/recurring-expenses/:id（部分更新）
router.patch('/recurring-expenses/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const updates = {};
    for (const [key, value] of Object.entries(body)) {
      if (!(key in RECURRING_PATCH_ALLOWED)) continue; // 許可外の列は無視
      updates[key] = RECURRING_PATCH_ALLOWED[key](value);
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: '更新可能な項目がありません', allowed: Object.keys(RECURRING_PATCH_ALLOWED) });
    }
    if ('category_id' in updates && !(await categoryExists(updates.category_id))) {
      throw badRequest(`存在しない category_id です: ${updates.category_id}`);
    }
    const keys = Object.keys(updates);
    const sets = keys.map((k, i) => `${k} = $${i + 2}`);
    const { rowCount } = await ana.query(
      `UPDATE recurring_expenses SET ${sets.join(', ')} WHERE id = $1`,
      [id, ...keys.map((k) => updates[k])]
    );
    if (rowCount === 0) return res.status(404).json({ error: `定期経費が見つかりません: id=${id}` });
    res.json(await withMeta({ recurring_expense: await fetchRecurringById(id) }));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/recurring-expenses/:id
// （展開済みの expenses は recurrence_id を保持したまま残る。FK は無いので削除可能）
router.delete('/recurring-expenses/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const { rowCount } = await ana.query('DELETE FROM recurring_expenses WHERE id = $1', [id]);
    if (rowCount === 0) return res.status(404).json({ error: `定期経費が見つかりません: id=${id}` });
    res.json(await withMeta({ deleted: true, id }));
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/recurring-expenses/generate { month: "YYYY-MM" }
// 有効な定期経費を当月の expenses に展開する。既存 (recurrence_id, period_month) はスキップ（冪等）
router.post('/recurring-expenses/generate', async (req, res, next) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const { month, start } = bd.monthRange(body.month);
    const { rows: actives } = await ana.query(
      'SELECT id, category_id, amount, day_of_month, alloc_method, vendor, memo FROM recurring_expenses WHERE is_active = TRUE ORDER BY id'
    );
    let inserted = 0;
    const client = await ana.pool.connect();
    try {
      await client.query('BEGIN');
      for (const r of actives) {
        const expenseDate = `${month}-${String(r.day_of_month).padStart(2, '0')}`;
        const { rowCount } = await client.query(
          `INSERT INTO expenses (expense_date, category_id, amount, alloc_method, vendor, memo, recurrence_id, period_month)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (recurrence_id, period_month) WHERE recurrence_id IS NOT NULL DO NOTHING`,
          [expenseDate, r.category_id, r.amount, r.alloc_method, r.vendor, r.memo, r.id, start]
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
    res.json(await withMeta({ month, inserted, skipped: actives.length - inserted }));
  } catch (err) {
    next(err);
  }
});

module.exports = router;

// CSV 出力(routes/export.js)・分析(routes/pl.js)から同一定義を再利用するための追加 export（sales.js と同じ流儀）
module.exports.resolveMonthOrRange = resolveMonthOrRange;
module.exports.fetchCategoryRows = fetchCategoryRows;
module.exports.fetchExpenseRows = fetchExpenseRows;
module.exports.fetchRecurringRows = fetchRecurringRows;
module.exports.PNL_LINES = PNL_LINES;
module.exports.COST_TYPES = COST_TYPES;
