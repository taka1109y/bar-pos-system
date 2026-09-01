import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Toolbar, Card, Alert, Badge, Button, Input, Field, Select, Textarea, Modal, Segmented, DataTable, StatTile, Skeleton } from '../components/ui';
import MonthBar from '../components/period/MonthBar';
import ExportCsvButton from '../components/ExportCsvButton';
import { todayJST } from '../utils/tz';
import { yen } from '../utils/format';
import { api } from '../api';
import { useToastStore } from '../store/useToastStore';

// 経費入力(/inputs/expenses)。
// 月ごとの経費を「一覧 + 先頭のインライン新規行」で入力し、編集はモーダル、削除は確認モーダル。
// CSV(date,category_code,amount[,vendor[,memo]])の貼り付け取込と、科目(expense_categories)の
// 管理モーダルも同居する。書き込み先はすべて analyticsdb。金額は円(整数)。
// 上部の小計タイルは P&L 行(pnl_line)別で、月次P&L(/pl/statement)の科目行と対応する。

const MONTH_RE = /^\d{4}-\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_AMOUNT = 100_000_000;
const LIST_LIMIT = 500;      // サーバの limit 上限(1リクエストで取得できる最大件数)
const CODE_RE = /^[a-z0-9_-]{1,32}$/;

// サーバ(routes/expenses.js)の PNL_LINES / COST_TYPES / ALLOC_METHODS と同値
const PNL_LINE_OPTIONS = [
  { value: 'purchase',  label: '仕入' },
  { value: 'labor',     label: '人件費' },
  { value: 'rent',      label: '家賃' },
  { value: 'utilities', label: '光熱費' },
  { value: 'supplies',  label: '消耗品' },
  { value: 'marketing', label: '販促' },
  { value: 'fees',      label: '手数料' },
  { value: 'other',     label: 'その他' },
];
const PNL_LINE_LABELS = Object.fromEntries(PNL_LINE_OPTIONS.map((o) => [o.value, o.label]));

const COST_TYPE_OPTIONS = [
  { value: 'fixed',    label: '固定費' },
  { value: 'variable', label: '変動費' },
];
const COST_TYPE_LABELS = Object.fromEntries(COST_TYPE_OPTIONS.map((o) => [o.value, o.label]));

const ALLOC_OPTIONS = [
  { value: 'date',       label: '計上日' },
  { value: 'month_even', label: '月内均等' },
];
const ALLOC_LABELS = Object.fromEntries(ALLOC_OPTIONS.map((o) => [o.value, o.label]));

const CSV_PLACEHOLDER = `date,category_code,amount,vendor,memo
2026-09-01,purchase,32000,酒屋,ビール仕入
2026-09-03,supplies,4800,業務スーパー,`;

// 金額入力の検証(空欄は未入力扱い = 保存不可だがエラー表示はしない)
function amountError(v) {
  const s = String(v ?? '').trim();
  if (s === '') return false;
  const n = Number(s);
  return !(Number.isInteger(n) && n >= 0 && n <= MAX_AMOUNT);
}
const amountFilled = (v) => String(v ?? '').trim() !== '' && !amountError(v);

// 科目 Select の選択肢(無効な科目は明示する。既存経費の編集で選択肢が消えないよう全件を出す)
function categoryOptions(cats, { placeholder = '科目を選択' } = {}) {
  return [
    { value: '', label: placeholder },
    ...cats.map((c) => ({ value: String(c.id), label: c.is_active ? c.name : `${c.name}(無効)` })),
  ];
}

// ── 経費の編集モーダル ─────────────────────────────
function ExpenseEditModal({ expense, cats, onClose }) {
  const qc = useQueryClient();
  const push = useToastStore((s) => s.push);
  const [err, setErr] = useState(null);
  const [form, setForm] = useState({
    expense_date: expense.expense_date,
    category_id: String(expense.category_id),
    amount: String(Math.round(expense.amount)),
    tax_included: expense.tax_included !== false,
    alloc_method: expense.alloc_method || 'date',
    vendor: expense.vendor ?? '',
    memo: expense.memo ?? '',
  });
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const saveM = useMutation({
    mutationFn: () => api.updateExpense(expense.id, {
      expense_date: form.expense_date,
      category_id: Number(form.category_id),
      amount: Number(String(form.amount).trim()),
      tax_included: form.tax_included,
      alloc_method: form.alloc_method,
      vendor: form.vendor.trim() || null,
      memo: form.memo.trim() || null,
    }),
    onSuccess: () => {
      push('経費を更新しました', 'success');
      qc.invalidateQueries({ queryKey: ['v1', 'expenses'] });
      qc.invalidateQueries({ queryKey: ['v1', 'pl'] });
      onClose();
    },
    onError: (e) => setErr(e.message),
  });

  const canSave = DATE_RE.test(form.expense_date) && form.category_id !== '' && amountFilled(form.amount) && !saveM.isPending;

  return (
    <Modal
      title="経費を編集"
      onClose={onClose}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>キャンセル</Button>
          <Button onClick={() => saveM.mutate()} disabled={!canSave} loading={saveM.isPending}>保存</Button>
        </>
      )}
    >
      <div className="space-y-3">
        {err && <Alert tone="danger" title="保存に失敗しました">{err}</Alert>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="日付" htmlFor="exp-edit-date" required>
            <Input id="exp-edit-date" type="date" value={form.expense_date} invalid={!DATE_RE.test(form.expense_date)}
              onChange={(e) => set({ expense_date: e.target.value })} />
          </Field>
          <Field label="金額(円)" htmlFor="exp-edit-amount" required error={amountError(form.amount) ? `0〜${yen(MAX_AMOUNT)} の整数で入力してください` : undefined}>
            <Input id="exp-edit-amount" type="number" min={0} max={MAX_AMOUNT} prefix="¥" className="text-right"
              value={form.amount} invalid={amountError(form.amount)}
              onChange={(e) => set({ amount: e.target.value })} />
          </Field>
        </div>
        <Field label="科目" htmlFor="exp-edit-cat" required>
          <Select id="exp-edit-cat" value={form.category_id} options={categoryOptions(cats)} invalid={form.category_id === ''}
            onChange={(e) => set({ category_id: e.target.value })} />
        </Field>
        <div className="flex flex-wrap gap-4">
          <Field label="税">
            <Segmented
              options={[{ value: true, label: '税込' }, { value: false, label: '税抜' }]}
              value={form.tax_included}
              onChange={(v) => set({ tax_included: v })}
            />
          </Field>
          <Field label="按分" hint="月内均等はP&Lで月内の営業日に均等按分されます">
            <Segmented options={ALLOC_OPTIONS} value={form.alloc_method} onChange={(v) => set({ alloc_method: v })} />
          </Field>
        </div>
        <Field label="取引先" htmlFor="exp-edit-vendor">
          <Input id="exp-edit-vendor" value={form.vendor} maxLength={100} placeholder="例: 酒屋"
            onChange={(e) => set({ vendor: e.target.value })} />
        </Field>
        <Field label="メモ" htmlFor="exp-edit-memo">
          <Textarea id="exp-edit-memo" rows={2} value={form.memo} maxLength={500}
            onChange={(e) => set({ memo: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

// ── 削除確認モーダル ─────────────────────────────
function DeleteExpenseModal({ expense, onClose }) {
  const qc = useQueryClient();
  const push = useToastStore((s) => s.push);
  const [err, setErr] = useState(null);
  const delM = useMutation({
    mutationFn: () => api.deleteExpense(expense.id),
    onSuccess: () => {
      push('経費を削除しました', 'success');
      qc.invalidateQueries({ queryKey: ['v1', 'expenses'] });
      qc.invalidateQueries({ queryKey: ['v1', 'pl'] });
      onClose();
    },
    onError: (e) => setErr(e.message),
  });
  return (
    <Modal
      title="経費を削除"
      size="sm"
      onClose={onClose}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>キャンセル</Button>
          <Button variant="danger" onClick={() => delM.mutate()} loading={delM.isPending}>削除する</Button>
        </>
      )}
    >
      <div className="space-y-3">
        {err && <Alert tone="danger" title="削除に失敗しました">{err}</Alert>}
        <p className="text-sm text-body">
          {expense.expense_date} の <span className="font-medium text-heading">{expense.category_name}</span>{' '}
          <span className="font-medium text-heading tabular-nums">¥{yen(expense.amount)}</span> を削除します。元に戻せません。
        </p>
      </div>
    </Modal>
  );
}

// ── CSV 取込モーダル ─────────────────────────────
function ImportCsvModal({ onClose }) {
  const qc = useQueryClient();
  const push = useToastStore((s) => s.push);
  const [csv, setCsv] = useState('');
  const [err, setErr] = useState(null); // { message, line, detail }

  const importM = useMutation({
    mutationFn: () => api.importExpensesCsv(csv),
    onSuccess: (d) => {
      push(`${d?.inserted ?? 0} 件を取り込みました`, 'success');
      qc.invalidateQueries({ queryKey: ['v1', 'expenses'] });
      qc.invalidateQueries({ queryKey: ['v1', 'pl'] });
      onClose();
    },
    onError: (e) => setErr({ message: e.message, line: e.body?.line ?? null, detail: e.body?.detail ?? null }),
  });

  return (
    <Modal
      title="CSV 取込"
      size="lg"
      onClose={onClose}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>キャンセル</Button>
          <Button onClick={() => { setErr(null); importM.mutate(); }} disabled={csv.trim() === '' || importM.isPending} loading={importM.isPending}>
            取込
          </Button>
        </>
      )}
    >
      <div className="space-y-3">
        {err && (
          <Alert tone="danger" title={err.line != null ? `${err.line} 行目で取込を中止しました` : '取込に失敗しました'}>
            <div>{err.message}</div>
            {err.detail && <div className="mt-0.5">{err.detail}</div>}
            <div className="mt-1 text-xs">1行でも不正があると1件も登録されません(全件検証してから一括登録)。</div>
          </Alert>
        )}
        <Alert tone="info" title="貼り付け形式">
          <code className="text-xs">date,category_code,amount[,vendor[,memo]]</code> の3〜5列。
          1行目が <code className="text-xs">date</code> で始まるヘッダ行は自動で読み飛ばします。
          <span className="ml-1">category_code は科目管理の code(例: purchase)です。</span>
        </Alert>
        <Field label="CSV(貼り付け)" htmlFor="exp-csv" hint="最大 1000 行">
          <Textarea id="exp-csv" rows={10} className="font-mono text-xs" placeholder={CSV_PLACEHOLDER}
            value={csv} onChange={(e) => setCsv(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

// ── 科目管理モーダル(CRUD) ─────────────────────────
const EMPTY_CAT = { id: null, code: '', name: '', cost_type: 'variable', pnl_line: 'other', sort_order: '0' };

function CategoryManagerModal({ onClose }) {
  const qc = useQueryClient();
  const push = useToastStore((s) => s.push);
  const [err, setErr] = useState(null);
  const [form, setForm] = useState(EMPTY_CAT);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const catsQ = useQuery({ queryKey: ['v1', 'expense-categories'], queryFn: api.getExpenseCategories });
  const cats = catsQ.data?.rows || [];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['v1', 'expense-categories'] });
    qc.invalidateQueries({ queryKey: ['v1', 'expenses'] });
    qc.invalidateQueries({ queryKey: ['v1', 'recurring-expenses'] });
    qc.invalidateQueries({ queryKey: ['v1', 'pl'] });
  };

  const saveM = useMutation({
    mutationFn: () => {
      const body = {
        code: form.code.trim(),
        name: form.name.trim(),
        cost_type: form.cost_type,
        pnl_line: form.pnl_line,
        sort_order: Number(String(form.sort_order).trim() || 0),
      };
      return form.id ? api.updateExpenseCategory(form.id, body) : api.createExpenseCategory(body);
    },
    onSuccess: (_d, _v, _c) => {
      setErr(null);
      push(form.id ? '科目を更新しました' : '科目を追加しました', 'success');
      setForm(EMPTY_CAT);
      invalidate();
    },
    onError: (e) => setErr(e.message),
  });

  const toggleM = useMutation({
    mutationFn: (c) => api.updateExpenseCategory(c.id, { is_active: !c.is_active }),
    onSuccess: () => { setErr(null); invalidate(); },
    onError: (e) => setErr(e.message),
  });

  const delM = useMutation({
    mutationFn: (c) => api.deleteExpenseCategory(c.id),
    onSuccess: () => { setErr(null); push('科目を削除しました', 'success'); invalidate(); },
    onError: (e) => setErr(e.message), // 使用中(409)はサーバのメッセージをそのまま表示
  });

  const codeInvalid = form.code.trim() !== '' && !CODE_RE.test(form.code.trim());
  const canSave = form.code.trim() !== '' && !codeInvalid && form.name.trim() !== '' && !saveM.isPending;

  const COLUMNS = [
    {
      key: 'name', header: '科目',
      render: (c) => (
        <span className="inline-flex items-center gap-1.5">
          <span className="text-heading font-medium">{c.name}</span>
          {!c.is_active && <Badge size="sm">無効</Badge>}
        </span>
      ),
    },
    { key: 'code', header: 'code', width: 120, render: (c) => <code className="text-2xs">{c.code}</code> },
    {
      key: 'cost_type', header: '固定/変動', width: 90,
      render: (c) => <Badge tone={c.cost_type === 'fixed' ? 'info' : 'neutral'}>{COST_TYPE_LABELS[c.cost_type] || '—'}</Badge>,
    },
    { key: 'pnl_line', header: 'P&L行', width: 90, render: (c) => PNL_LINE_LABELS[c.pnl_line] || '—' },
    { key: 'expense_count', header: '使用件数', align: 'right', width: 80, render: (c) => <span className="tabular-nums">{c.expense_count} 件</span> },
    {
      key: 'ops', header: '操作', align: 'right', width: 200,
      render: (c) => (
        <span className="inline-flex items-center gap-1.5">
          <Button variant="secondary" size="sm" onClick={() => setForm({
            id: c.id, code: c.code, name: c.name,
            cost_type: c.cost_type || 'variable', pnl_line: c.pnl_line || 'other',
            sort_order: String(c.sort_order ?? 0),
          })}>編集</Button>
          <Button variant="secondary" size="sm" onClick={() => toggleM.mutate(c)}
            loading={toggleM.isPending && toggleM.variables?.id === c.id}>
            {c.is_active ? '無効化' : '有効化'}
          </Button>
          <Button variant="danger" size="sm" onClick={() => delM.mutate(c)}
            loading={delM.isPending && delM.variables?.id === c.id}>削除</Button>
        </span>
      ),
    },
  ];

  return (
    <Modal title="科目管理" size="xl" onClose={onClose}>
      <div className="space-y-3">
        {err && <Alert tone="danger" title="操作に失敗しました">{err}</Alert>}

        <div className="flex flex-wrap items-end gap-2 p-3 rounded-lg bg-surface-sunken border border-line">
          <Field label="code" htmlFor="cat-code" className="w-36" required
            error={codeInvalid ? '英小文字・数字・-・_ の1〜32文字' : undefined}>
            <Input id="cat-code" size="sm" value={form.code} invalid={codeInvalid} placeholder="rent"
              onChange={(e) => set({ code: e.target.value })} />
          </Field>
          <Field label="科目名" htmlFor="cat-name" className="w-44" required>
            <Input id="cat-name" size="sm" value={form.name} maxLength={50} placeholder="家賃"
              onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <Field label="固定/変動" htmlFor="cat-cost" className="w-28">
            <Select id="cat-cost" size="sm" value={form.cost_type} options={COST_TYPE_OPTIONS}
              onChange={(e) => set({ cost_type: e.target.value })} />
          </Field>
          <Field label="P&L行" htmlFor="cat-pnl" className="w-32">
            <Select id="cat-pnl" size="sm" value={form.pnl_line} options={PNL_LINE_OPTIONS}
              onChange={(e) => set({ pnl_line: e.target.value })} />
          </Field>
          <Field label="並び順" htmlFor="cat-sort" className="w-20">
            <Input id="cat-sort" size="sm" type="number" min={0} max={9999} value={form.sort_order}
              onChange={(e) => set({ sort_order: e.target.value })} />
          </Field>
          <div className="leading-normal flex items-center gap-2">
            <Button size="sm" onClick={() => saveM.mutate()} disabled={!canSave} loading={saveM.isPending}>
              {form.id ? '更新' : '追加'}
            </Button>
            {form.id && <Button size="sm" variant="ghost" onClick={() => { setForm(EMPTY_CAT); setErr(null); }}>取消</Button>}
          </div>
        </div>

        {catsQ.isError ? (
          <Alert tone="danger" title="科目を取得できません">{catsQ.error?.message}</Alert>
        ) : catsQ.isLoading ? (
          <Skeleton height={200} />
        ) : (
          <DataTable columns={COLUMNS} rows={cats} rowKey={(c) => c.id} />
        )}

        <p className="text-2xs text-muted">
          経費・定期経費で使用中の科目は削除できません(409)。使わなくなった科目は「無効化」してください。
          固定/変動は損益分岐点(/pl/breakeven)の固定費・変動費の判定に、P&L行は月次P&L(/pl/statement)の行に使われます。
        </p>
      </div>
    </Modal>
  );
}

// ── 本体 ─────────────────────────────────────────
export default function ExpensesPage() {
  const qc = useQueryClient();
  const push = useToastStore((s) => s.push);
  const [month, setMonth] = useState(() => todayJST().slice(0, 7));
  const [filterCat, setFilterCat] = useState('');
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [showImport, setShowImport] = useState(false);
  const [showCats, setShowCats] = useState(false);
  const [addErr, setAddErr] = useState(null);

  const monthValid = MONTH_RE.test(month);

  const catsQ = useQuery({ queryKey: ['v1', 'expense-categories'], queryFn: api.getExpenseCategories });
  const cats = catsQ.data?.rows || [];
  const activeCats = cats.filter((c) => c.is_active);

  const expQ = useQuery({
    queryKey: ['v1', 'expenses', month, filterCat],
    queryFn: () => api.getExpenses({ month, category_id: filterCat || undefined, limit: LIST_LIMIT }),
    enabled: monthValid,
  });
  const rows = expQ.data?.rows || [];
  const totalCount = expQ.data?.total_count ?? rows.length;
  const totalAmount = expQ.data?.total_amount ?? 0;
  const truncated = totalCount > rows.length;

  // インライン新規行。月を変えたら日付の既定値も月内へ寄せる(今月なら今日)
  const defaultDate = useMemo(() => {
    if (!monthValid) return todayJST();
    return todayJST().slice(0, 7) === month ? todayJST() : `${month}-01`;
  }, [month, monthValid]);
  const [draft, setDraft] = useState({ expense_date: defaultDate, category_id: '', amount: '', vendor: '', memo: '' });
  useEffect(() => { setDraft((d) => ({ ...d, expense_date: defaultDate })); }, [defaultDate]);

  const createM = useMutation({
    mutationFn: () => api.createExpense({
      expense_date: draft.expense_date,
      category_id: Number(draft.category_id),
      amount: Number(String(draft.amount).trim()),
      vendor: draft.vendor.trim() || null,
      memo: draft.memo.trim() || null,
    }),
    onSuccess: () => {
      setAddErr(null);
      push('経費を登録しました', 'success');
      // 日付と科目は残して連続入力しやすくする
      setDraft((d) => ({ ...d, amount: '', vendor: '', memo: '' }));
      qc.invalidateQueries({ queryKey: ['v1', 'expenses'] });
      qc.invalidateQueries({ queryKey: ['v1', 'pl'] });
    },
    onError: (e) => setAddErr(e.message),
  });

  const canCreate = DATE_RE.test(draft.expense_date) && draft.category_id !== '' && amountFilled(draft.amount) && !createM.isPending;
  const onDraftKeyDown = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (canCreate) createM.mutate();
  };

  // P&L 行別の小計(表示中の行から算出)
  const subtotals = useMemo(() => {
    const m = new Map();
    for (const r of rows) {
      const key = r.pnl_line || 'other';
      const cur = m.get(key) || { amount: 0, count: 0 };
      m.set(key, { amount: cur.amount + Number(r.amount || 0), count: cur.count + 1 });
    }
    return PNL_LINE_OPTIONS.filter((o) => m.has(o.value)).map((o) => ({ ...o, ...m.get(o.value) }));
  }, [rows]);

  const COLUMNS = [
    { key: 'expense_date', header: '日付', width: 110, render: (r) => <span className="tabular-nums text-heading font-medium">{r.expense_date}</span> },
    {
      key: 'category_name', header: '科目', width: 190,
      render: (r) => (
        <span className="inline-flex items-center gap-1.5">
          <span className="text-heading">{r.category_name}</span>
          <Badge size="sm" tone={r.cost_type === 'fixed' ? 'info' : 'neutral'}>{COST_TYPE_LABELS[r.cost_type] || '—'}</Badge>
          {r.recurrence_id != null && <Badge size="sm" tone="warning">定期</Badge>}
        </span>
      ),
    },
    { key: 'amount', header: '金額', align: 'right', width: 110, render: (r) => <span className="tabular-nums font-medium text-heading">¥{yen(r.amount)}</span> },
    { key: 'vendor', header: '取引先', width: 150, render: (r) => r.vendor || <span className="text-faint">—</span> },
    { key: 'memo', header: 'メモ', render: (r) => <span className="text-body">{r.memo || <span className="text-faint">—</span>}</span> },
    {
      key: 'alloc_method', header: '按分', width: 90,
      render: (r) => <span className="text-muted text-2xs">{ALLOC_LABELS[r.alloc_method] || r.alloc_method}</span>,
    },
    {
      key: 'ops', header: '操作', align: 'right', width: 130,
      render: (r) => (
        <span className="inline-flex items-center gap-1.5">
          <Button variant="secondary" size="sm" onClick={() => setEditing(r)}>編集</Button>
          <Button variant="danger" size="sm" onClick={() => setDeleting(r)}>削除</Button>
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <Toolbar title="経費" subtitle="月ごとの経費を入力し、P&L・損益分岐点の集計に反映する">
        <Button variant="secondary" onClick={() => setShowCats(true)}>科目管理</Button>
        <Button variant="secondary" onClick={() => setShowImport(true)}>CSV 取込</Button>
        <ExportCsvButton report="expenses" params={{ month, category_id: filterCat || undefined }} />
      </Toolbar>

      <Card dense>
        <div className="flex flex-wrap items-end gap-3">
          <div className="leading-normal">
            <span className="block text-xs font-medium text-body mb-1">月</span>
            <MonthBar month={month} onChange={setMonth} />
          </div>
          <Field label="科目で絞り込み" htmlFor="exp-filter-cat" className="w-48">
            <Select id="exp-filter-cat" size="sm" value={filterCat}
              options={categoryOptions(cats, { placeholder: 'すべての科目' })}
              onChange={(e) => setFilterCat(e.target.value)} />
          </Field>
          <div className="leading-normal h-8 flex items-center text-xs text-muted tabular-nums">
            {expQ.isSuccess ? `${totalCount} 件 / 合計 ¥${yen(totalAmount)}` : ''}
          </div>
        </div>
      </Card>

      {cats.length > 0 && activeCats.length === 0 && (
        <Alert tone="warning" title="有効な科目がありません">「科目管理」で科目を追加するか、無効化した科目を有効化してください。</Alert>
      )}
      {truncated && (
        <Alert tone="warning" title="表示件数の上限に達しました">
          この月の経費は {totalCount} 件ありますが、先頭 {rows.length} 件のみ表示しています(小計タイルも表示中の分のみ)。
          科目で絞り込むか、CSV でダウンロードして確認してください。
        </Alert>
      )}

      {subtotals.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-3">
          <StatTile dense label="合計" value={`¥${yen(rows.reduce((a, r) => a + Number(r.amount || 0), 0))}`} sub={`${rows.length} 件`} />
          {subtotals.map((s) => (
            <StatTile key={s.value} dense label={s.label} value={`¥${yen(s.amount)}`} sub={`${s.count} 件`} />
          ))}
        </div>
      )}

      <Card title="経費一覧" padded={false}>
        <div className="px-3 py-2 border-b border-line bg-surface-sunken" onKeyDown={onDraftKeyDown}>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="日付" htmlFor="exp-new-date" className="w-36">
              <Input id="exp-new-date" size="sm" type="date" value={draft.expense_date}
                invalid={!DATE_RE.test(draft.expense_date)}
                onChange={(e) => setDraft((d) => ({ ...d, expense_date: e.target.value }))} />
            </Field>
            <Field label="科目" htmlFor="exp-new-cat" className="w-44">
              <Select id="exp-new-cat" size="sm" value={draft.category_id}
                options={categoryOptions(activeCats)}
                onChange={(e) => setDraft((d) => ({ ...d, category_id: e.target.value }))} />
            </Field>
            <Field label="金額" htmlFor="exp-new-amount" className="w-32">
              <Input id="exp-new-amount" size="sm" type="number" min={0} max={MAX_AMOUNT} prefix="¥" className="text-right"
                value={draft.amount} invalid={amountError(draft.amount)} placeholder="0"
                onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value }))} />
            </Field>
            <Field label="取引先" htmlFor="exp-new-vendor" className="w-40">
              <Input id="exp-new-vendor" size="sm" value={draft.vendor} maxLength={100} placeholder="任意"
                onChange={(e) => setDraft((d) => ({ ...d, vendor: e.target.value }))} />
            </Field>
            <Field label="メモ" htmlFor="exp-new-memo" className="min-w-48 flex-1">
              <Input id="exp-new-memo" size="sm" value={draft.memo} maxLength={500} placeholder="任意(Enter で登録)"
                onChange={(e) => setDraft((d) => ({ ...d, memo: e.target.value }))} />
            </Field>
            <div className="leading-normal">
              <Button size="sm" onClick={() => createM.mutate()} disabled={!canCreate} loading={createM.isPending}>追加</Button>
            </div>
          </div>
          {addErr && <Alert tone="danger" className="mt-2">{addErr}</Alert>}
        </div>

        {expQ.isError ? (
          <div className="p-3"><Alert tone="danger" title="経費を取得できません">{expQ.error?.message}</Alert></div>
        ) : expQ.isLoading ? (
          <div className="p-3"><Skeleton height={240} /></div>
        ) : (
          <DataTable
            columns={COLUMNS}
            rows={rows}
            rowKey={(r) => r.id}
            className="border-0 rounded-none"
            empty={<div className="py-10 text-center text-sm text-muted">この月の経費はまだありません。上の行から追加できます。</div>}
          />
        )}
      </Card>

      <p className="text-2xs text-muted">
        金額は税込・税抜のどちらでも記録できます(既定は税込。P&L は入力された金額をそのまま集計します)。
        按分「月内均等」の経費は月次P&Lで月内に均等按分されます。
        <span className="ml-1">仕入(purchase)はレシピ原価と二重計上になるため、営業利益には含めず参考行として扱われます。</span>
      </p>

      {editing && <ExpenseEditModal expense={editing} cats={cats} onClose={() => setEditing(null)} />}
      {deleting && <DeleteExpenseModal expense={deleting} onClose={() => setDeleting(null)} />}
      {showImport && <ImportCsvModal onClose={() => setShowImport(false)} />}
      {showCats && <CategoryManagerModal onClose={() => setShowCats(false)} />}
    </div>
  );
}
