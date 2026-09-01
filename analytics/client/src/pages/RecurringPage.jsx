import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Toolbar, Card, Alert, Badge, Button, Input, Field, Select, Textarea, Modal, Segmented, DataTable, Skeleton } from '../components/ui';
import MonthBar from '../components/period/MonthBar';
import { todayJST } from '../utils/tz';
import { yen } from '../utils/format';
import { api } from '../api';
import { useToastStore } from '../store/useToastStore';

// 定期経費(/inputs/recurring)。
// 毎月かかる固定的な経費(家賃・サブスク等)をテンプレートとして登録し、
// 「YYYY-MM 分を生成」でその月の経費(expenses)へ一括展開する。
// 展開は (定期経費, 対象月) の一意制約で冪等: 同じ月に何度実行しても重複しない。

const MONTH_RE = /^\d{4}-\d{2}$/;
const MAX_AMOUNT = 100_000_000;

// サーバ(routes/expenses.js)の ALLOC_METHODS と同値
const ALLOC_OPTIONS = [
  { value: 'date',       label: '計上日' },
  { value: 'month_even', label: '月内均等' },
];
const ALLOC_LABELS = Object.fromEntries(ALLOC_OPTIONS.map((o) => [o.value, o.label]));
const COST_TYPE_LABELS = { fixed: '固定費', variable: '変動費' };

const EMPTY = { category_id: '', amount: '', day_of_month: '1', alloc_method: 'month_even', vendor: '', memo: '', is_active: true };

function amountError(v) {
  const s = String(v ?? '').trim();
  if (s === '') return false;
  const n = Number(s);
  return !(Number.isInteger(n) && n >= 0 && n <= MAX_AMOUNT);
}
const amountFilled = (v) => String(v ?? '').trim() !== '' && !amountError(v);

function dayError(v) {
  const s = String(v ?? '').trim();
  if (s === '') return true;
  const n = Number(s);
  return !(Number.isInteger(n) && n >= 1 && n <= 28);
}

function categoryOptions(cats, { placeholder = '科目を選択' } = {}) {
  return [
    { value: '', label: placeholder },
    ...cats.map((c) => ({ value: String(c.id), label: c.is_active ? c.name : `${c.name}(無効)` })),
  ];
}

// フォーム本体(追加行・編集モーダルで共用)
function RecurringFields({ form, set, cats, idPrefix, size = 'md' }) {
  return (
    <>
      <Field label="科目" htmlFor={`${idPrefix}-cat`} className="w-44" required>
        <Select id={`${idPrefix}-cat`} size={size} value={form.category_id} options={categoryOptions(cats)}
          invalid={form.category_id === ''}
          onChange={(e) => set({ category_id: e.target.value })} />
      </Field>
      <Field label="金額" htmlFor={`${idPrefix}-amount`} className="w-32" required>
        <Input id={`${idPrefix}-amount`} size={size} type="number" min={0} max={MAX_AMOUNT} prefix="¥" className="text-right"
          value={form.amount} invalid={amountError(form.amount)} placeholder="0"
          onChange={(e) => set({ amount: e.target.value })} />
      </Field>
      <Field label="計上日" htmlFor={`${idPrefix}-day`} className="w-24" hint="1〜28日">
        <Input id={`${idPrefix}-day`} size={size} type="number" min={1} max={28} suffix="日" className="text-right"
          value={form.day_of_month} invalid={dayError(form.day_of_month)}
          onChange={(e) => set({ day_of_month: e.target.value })} />
      </Field>
      <Field label="按分" className="leading-normal">
        <Segmented options={ALLOC_OPTIONS} value={form.alloc_method} size="sm" onChange={(v) => set({ alloc_method: v })} />
      </Field>
      <Field label="取引先" htmlFor={`${idPrefix}-vendor`} className="w-40">
        <Input id={`${idPrefix}-vendor`} size={size} value={form.vendor} maxLength={100} placeholder="任意"
          onChange={(e) => set({ vendor: e.target.value })} />
      </Field>
    </>
  );
}

// ── 編集モーダル ─────────────────────────────────
function RecurringEditModal({ item, cats, onClose }) {
  const qc = useQueryClient();
  const push = useToastStore((s) => s.push);
  const [err, setErr] = useState(null);
  const [form, setForm] = useState({
    category_id: String(item.category_id),
    amount: String(Math.round(item.amount)),
    day_of_month: String(item.day_of_month ?? 1),
    alloc_method: item.alloc_method || 'month_even',
    vendor: item.vendor ?? '',
    memo: item.memo ?? '',
    is_active: item.is_active !== false,
  });
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const saveM = useMutation({
    mutationFn: () => api.updateRecurringExpense(item.id, {
      category_id: Number(form.category_id),
      amount: Number(String(form.amount).trim()),
      day_of_month: Number(String(form.day_of_month).trim()),
      alloc_method: form.alloc_method,
      vendor: form.vendor.trim() || null,
      memo: form.memo.trim() || null,
      is_active: form.is_active,
    }),
    onSuccess: () => {
      push('定期経費を更新しました', 'success');
      qc.invalidateQueries({ queryKey: ['v1', 'recurring-expenses'] });
      onClose();
    },
    onError: (e) => setErr(e.message),
  });

  const canSave = form.category_id !== '' && amountFilled(form.amount) && !dayError(form.day_of_month) && !saveM.isPending;

  return (
    <Modal
      title="定期経費を編集"
      size="lg"
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
        <div className="flex flex-wrap items-end gap-3">
          <RecurringFields form={form} set={set} cats={cats} idPrefix="rec-edit" />
          <Field label="有効">
            <Segmented
              options={[{ value: true, label: '有効' }, { value: false, label: '停止' }]}
              value={form.is_active}
              size="sm"
              onChange={(v) => set({ is_active: v })}
            />
          </Field>
        </div>
        <Field label="メモ" htmlFor="rec-edit-memo">
          <Textarea id="rec-edit-memo" rows={2} value={form.memo} maxLength={500}
            onChange={(e) => set({ memo: e.target.value })} />
        </Field>
        <p className="text-2xs text-muted">
          金額や計上日を変えても、すでに生成済みの経費は変わりません(生成済みの月は「経費」ページで直接編集してください)。
        </p>
      </div>
    </Modal>
  );
}

// ── 削除確認モーダル ─────────────────────────────
function DeleteRecurringModal({ item, onClose }) {
  const qc = useQueryClient();
  const push = useToastStore((s) => s.push);
  const [err, setErr] = useState(null);
  const delM = useMutation({
    mutationFn: () => api.deleteRecurringExpense(item.id),
    onSuccess: () => {
      push('定期経費を削除しました', 'success');
      qc.invalidateQueries({ queryKey: ['v1', 'recurring-expenses'] });
      onClose();
    },
    onError: (e) => setErr(e.message),
  });
  return (
    <Modal
      title="定期経費を削除"
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
          <span className="font-medium text-heading">{item.category_name}</span>{' '}
          <span className="font-medium text-heading tabular-nums">¥{yen(item.amount)}</span>(毎月 {item.day_of_month} 日)を削除します。
        </p>
        <p className="text-xs text-muted">
          すでに生成済みの経費は削除されません。今後生成されなくなるだけです(一時的に止めたいだけなら「停止」にしてください)。
        </p>
      </div>
    </Modal>
  );
}

// ── 本体 ─────────────────────────────────────────
export default function RecurringPage() {
  const qc = useQueryClient();
  const push = useToastStore((s) => s.push);
  const [month, setMonth] = useState(() => todayJST().slice(0, 7));
  const [genResult, setGenResult] = useState(null); // { month, inserted, skipped } | { error }
  const [draft, setDraft] = useState(EMPTY);
  const [addErr, setAddErr] = useState(null);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const catsQ = useQuery({ queryKey: ['v1', 'expense-categories'], queryFn: api.getExpenseCategories });
  const cats = catsQ.data?.rows || [];
  const activeCats = cats.filter((c) => c.is_active);

  const recQ = useQuery({ queryKey: ['v1', 'recurring-expenses'], queryFn: api.getRecurringExpenses });
  const rows = recQ.data?.rows || [];
  const activeRows = rows.filter((r) => r.is_active);
  const monthlyTotal = activeRows.reduce((a, r) => a + Number(r.amount || 0), 0);

  const createM = useMutation({
    mutationFn: () => api.createRecurringExpense({
      category_id: Number(draft.category_id),
      amount: Number(String(draft.amount).trim()),
      day_of_month: Number(String(draft.day_of_month).trim()),
      alloc_method: draft.alloc_method,
      vendor: draft.vendor.trim() || null,
      memo: draft.memo.trim() || null,
      is_active: true,
    }),
    onSuccess: () => {
      setAddErr(null);
      push('定期経費を追加しました', 'success');
      setDraft(EMPTY);
      qc.invalidateQueries({ queryKey: ['v1', 'recurring-expenses'] });
    },
    onError: (e) => setAddErr(e.message),
  });

  const toggleM = useMutation({
    mutationFn: (r) => api.updateRecurringExpense(r.id, { is_active: !r.is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['v1', 'recurring-expenses'] }),
    onError: (e) => push(`更新に失敗しました: ${e.message}`, 'danger'),
  });

  const generateM = useMutation({
    mutationFn: () => api.generateRecurringExpenses(month),
    onSuccess: (d) => {
      setGenResult({ month: d?.month ?? month, inserted: d?.inserted ?? 0, skipped: d?.skipped ?? 0 });
      qc.invalidateQueries({ queryKey: ['v1', 'expenses'] });
      qc.invalidateQueries({ queryKey: ['v1', 'pl'] });
    },
    onError: (e) => setGenResult({ error: e.message }),
  });

  const canCreate = draft.category_id !== '' && amountFilled(draft.amount) && !dayError(draft.day_of_month) && !createM.isPending;
  const onDraftKeyDown = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (canCreate) createM.mutate();
  };

  const COLUMNS = [
    {
      key: 'category_name', header: '科目', width: 200,
      render: (r) => (
        <span className="inline-flex items-center gap-1.5">
          <span className="text-heading font-medium">{r.category_name}</span>
          <Badge size="sm" tone={r.cost_type === 'fixed' ? 'info' : 'neutral'}>{COST_TYPE_LABELS[r.cost_type] || '—'}</Badge>
          {!r.is_active && <Badge size="sm" tone="warning">停止中</Badge>}
        </span>
      ),
    },
    { key: 'amount', header: '金額', align: 'right', width: 110, render: (r) => <span className="tabular-nums font-medium text-heading">¥{yen(r.amount)}</span> },
    { key: 'day_of_month', header: '計上日', align: 'right', width: 80, render: (r) => <span className="tabular-nums">毎月 {r.day_of_month} 日</span> },
    { key: 'alloc_method', header: '按分', width: 90, render: (r) => <span className="text-muted text-2xs">{ALLOC_LABELS[r.alloc_method] || r.alloc_method}</span> },
    { key: 'vendor', header: '取引先', width: 150, render: (r) => r.vendor || <span className="text-faint">—</span> },
    { key: 'memo', header: 'メモ', render: (r) => r.memo || <span className="text-faint">—</span> },
    {
      key: 'ops', header: '操作', align: 'right', width: 200,
      render: (r) => (
        <span className="inline-flex items-center gap-1.5">
          <Button variant="secondary" size="sm" onClick={() => setEditing(r)}>編集</Button>
          <Button variant="secondary" size="sm" onClick={() => toggleM.mutate(r)}
            loading={toggleM.isPending && toggleM.variables?.id === r.id}>
            {r.is_active ? '停止' : '再開'}
          </Button>
          <Button variant="danger" size="sm" onClick={() => setDeleting(r)}>削除</Button>
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <Toolbar title="定期経費" subtitle="毎月かかる経費をテンプレート登録し、月ごとに経費へ一括生成する" />

      <Card title="今月分の生成">
        <div className="flex flex-wrap items-end gap-3">
          <div className="leading-normal">
            <span className="block text-xs font-medium text-body mb-1">生成する月</span>
            <MonthBar month={month} onChange={setMonth} />
          </div>
          <div className="leading-normal">
            <Button
              onClick={() => { setGenResult(null); generateM.mutate(); }}
              disabled={!MONTH_RE.test(month) || activeRows.length === 0 || generateM.isPending}
              loading={generateM.isPending}
            >
              {month} 分を生成
            </Button>
          </div>
          <div className="leading-normal h-9 flex items-center text-xs text-muted tabular-nums">
            有効 {activeRows.length} 件 / 月あたり ¥{yen(monthlyTotal)}
          </div>
        </div>

        {activeRows.length === 0 && rows.length > 0 && (
          <Alert tone="warning" className="mt-3">有効な定期経費がありません(すべて停止中)。生成しても0件です。</Alert>
        )}

        {genResult && (
          genResult.error ? (
            <Alert tone="danger" title="生成に失敗しました" className="mt-3">{genResult.error}</Alert>
          ) : (
            <Alert
              tone={genResult.inserted > 0 ? 'success' : 'info'}
              title={`${genResult.month} 分: 追加 ${genResult.inserted} 件 / スキップ ${genResult.skipped} 件`}
              className="mt-3"
            >
              {genResult.inserted > 0
                ? '「経費」ページに反映しました。金額や日付の調整は経費側で直接編集できます。'
                : 'この月はすでに生成済みです。同じ月に何度実行しても重複して追加されません(冪等)。'}
            </Alert>
          )
        )}
      </Card>

      <Card title="定期経費の一覧" padded={false}>
        <div className="px-3 py-2 border-b border-line bg-surface-sunken" onKeyDown={onDraftKeyDown}>
          <div className="flex flex-wrap items-end gap-2">
            <RecurringFields form={draft} set={(patch) => setDraft((d) => ({ ...d, ...patch }))} cats={activeCats} idPrefix="rec-new" size="sm" />
            <Field label="メモ" htmlFor="rec-new-memo" className="min-w-40 flex-1">
              <Input id="rec-new-memo" size="sm" value={draft.memo} maxLength={500} placeholder="任意(Enter で追加)"
                onChange={(e) => setDraft((d) => ({ ...d, memo: e.target.value }))} />
            </Field>
            <div className="leading-normal">
              <Button size="sm" onClick={() => createM.mutate()} disabled={!canCreate} loading={createM.isPending}>追加</Button>
            </div>
          </div>
          {addErr && <Alert tone="danger" className="mt-2">{addErr}</Alert>}
        </div>

        {recQ.isError ? (
          <div className="p-3"><Alert tone="danger" title="定期経費を取得できません">{recQ.error?.message}</Alert></div>
        ) : recQ.isLoading ? (
          <div className="p-3"><Skeleton height={200} /></div>
        ) : (
          <DataTable
            columns={COLUMNS}
            rows={rows}
            rowKey={(r) => r.id}
            className="border-0 rounded-none"
            empty={<div className="py-10 text-center text-sm text-muted">定期経費はまだありません。上の行から追加できます。</div>}
          />
        )}
      </Card>

      <p className="text-2xs text-muted">
        生成すると、有効な定期経費が「その月の計上日」の経費として登録されます(科目・金額・按分・取引先・メモを引き継ぎ)。
        経費一覧では「定期」バッジが付きます。停止中の定期経費は生成されません。
      </p>

      {editing && <RecurringEditModal item={editing} cats={cats} onClose={() => setEditing(null)} />}
      {deleting && <DeleteRecurringModal item={deleting} onClose={() => setDeleting(null)} />}
    </div>
  );
}
