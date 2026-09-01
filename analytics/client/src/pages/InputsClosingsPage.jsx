import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Toolbar, Card, Alert, Button, Input, DataTable, Skeleton, cn } from '../components/ui';
import MonthBar from '../components/period/MonthBar';
import { todayJST } from '../utils/tz';
import { yen } from '../utils/format';
import { api } from '../api';
import { useToastStore } from '../store/useToastStore';
import { DOW_LABELS } from '../components/charts/chartTheme';

// レジ精算(現金過不足)入力(/inputs/closings)。
// 月ごとに営業日の一覧(現金売上は bardb から自動)を表示し、開始現金・実査現金・メモを
// 行ごとに保存する(PUT /api/v1/register-closings/:date)。
// 過不足 = 実査現金 − (開始現金 + 現金売上)。負 = 現金が足りない(赤)、正 = 多い(緑)。

const MONTH_RE = /^\d{4}-\d{2}$/;
const MAX_CASH = 10_000_000;

// 'YYYY-MM-DD' → 曜日ラベル(UTC 固定で閲覧端末のTZに依存させない)
function dowLabel(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return DOW_LABELS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] || '';
}

// 入力値の検証: 空欄でなく 0〜MAX_CASH の整数のみ有効
function cashError(v) {
  const s = String(v ?? '').trim();
  if (s === '') return true; // 未入力(保存不可だがエラー表示はしない)
  const n = Number(s);
  return !(Number.isInteger(n) && n >= 0 && n <= MAX_CASH) ? 'invalid' : null;
}

// 過不足の表示。「¥-500」にならないよう符号を金額の前に出す
function diffText(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n < 0) return `-¥${yen(Math.abs(n))}`;
  if (n > 0) return `+¥${yen(n)}`;
  return '±¥0';
}

export default function InputsClosingsPage() {
  const qc = useQueryClient();
  const push = useToastStore((s) => s.push);
  const [month, setMonth] = useState(() => todayJST().slice(0, 7));
  const [draft, setDraft] = useState({}); // business_date -> { open_cash, counted_cash, memo }

  const monthValid = MONTH_RE.test(month);
  const closQ = useQuery({
    queryKey: ['v1', 'register-closings', month],
    queryFn: () => api.getRegisterClosings(month),
    enabled: monthValid,
  });
  const rows = closQ.data?.rows || [];

  // 取得(保存後の再取得含む)のたびにサーバ値からドラフトを作り直す
  useEffect(() => {
    const next = {};
    for (const r of closQ.data?.rows || []) {
      next[r.business_date] = {
        open_cash: r.open_cash == null ? '' : String(r.open_cash),
        counted_cash: r.counted_cash == null ? '' : String(r.counted_cash),
        memo: r.memo ?? '',
      };
    }
    setDraft(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closQ.dataUpdatedAt]);

  const saveM = useMutation({
    mutationFn: ({ date, body }) => api.putRegisterClosing(date, body),
    onSuccess: (_d, { date }) => {
      push(`${date} の精算を保存しました`, 'success');
      qc.invalidateQueries({ queryKey: ['v1', 'register-closings'] });
    },
    onError: (e) => push(`保存に失敗しました: ${e.message}`, 'danger'),
  });

  const saveRow = (r) => {
    const d = draft[r.business_date] || {};
    saveM.mutate({
      date: r.business_date,
      body: {
        open_cash: Number(String(d.open_cash).trim()),
        counted_cash: Number(String(d.counted_cash).trim()),
        memo: String(d.memo ?? '').trim() || null,
      },
    });
  };

  // 表示用の過不足: 入力中の値があればライブ計算、なければ保存済みの cash_diff
  const diffOf = (r) => {
    const d = draft[r.business_date] || {};
    const o = String(d.open_cash ?? '').trim();
    const c = String(d.counted_cash ?? '').trim();
    if (o !== '' && c !== '' && !cashError(o) && !cashError(c)) {
      return Number(c) - (Number(o) + Math.round(Number(r.cash_sales) || 0));
    }
    return r.cash_diff ?? null;
  };

  const COLUMNS = [
    {
      key: 'business_date', header: '営業日', width: 130,
      render: (r) => (
        <span className="text-heading font-medium tabular-nums">
          {r.business_date}
          <span className="ml-1 text-2xs text-muted">({dowLabel(r.business_date)})</span>
        </span>
      ),
    },
    {
      key: 'cash_sales', header: '現金売上(自動)', align: 'right', width: 120,
      render: (r) => <span className="tabular-nums">¥{yen(r.cash_sales)}</span>,
    },
    {
      key: 'open_cash', header: '開始現金', align: 'right', width: 130,
      render: (r) => (
        <Input
          size="sm" type="number" min={0} max={MAX_CASH} className="w-28 text-right"
          value={draft[r.business_date]?.open_cash ?? ''}
          invalid={cashError(draft[r.business_date]?.open_cash) === 'invalid'}
          placeholder="釣り銭準備金"
          aria-label={`${r.business_date} の開始現金`}
          onChange={(e) => setDraft((d) => ({ ...d, [r.business_date]: { ...d[r.business_date], open_cash: e.target.value } }))}
        />
      ),
    },
    {
      key: 'counted_cash', header: '実査現金', align: 'right', width: 130,
      render: (r) => (
        <Input
          size="sm" type="number" min={0} max={MAX_CASH} className="w-28 text-right"
          value={draft[r.business_date]?.counted_cash ?? ''}
          invalid={cashError(draft[r.business_date]?.counted_cash) === 'invalid'}
          placeholder="数えた現金"
          aria-label={`${r.business_date} の実査現金`}
          onChange={(e) => setDraft((d) => ({ ...d, [r.business_date]: { ...d[r.business_date], counted_cash: e.target.value } }))}
        />
      ),
    },
    {
      key: 'cash_diff', header: '過不足', align: 'right', width: 100,
      render: (r) => {
        const n = diffOf(r);
        return (
          <span className={cn('font-semibold tabular-nums', n != null && n < 0 ? 'text-danger' : n != null && n > 0 ? 'text-success' : 'text-muted')}>
            {diffText(n)}
          </span>
        );
      },
    },
    {
      key: 'memo', header: 'メモ',
      render: (r) => (
        <Input
          size="sm" className="min-w-40"
          value={draft[r.business_date]?.memo ?? ''}
          placeholder="例: 両替 5,000 円"
          aria-label={`${r.business_date} のメモ`}
          onChange={(e) => setDraft((d) => ({ ...d, [r.business_date]: { ...d[r.business_date], memo: e.target.value } }))}
        />
      ),
    },
    {
      key: 'save', header: '', align: 'right', width: 80,
      render: (r) => {
        const d = draft[r.business_date] || {};
        const filled = String(d.open_cash ?? '').trim() !== '' && String(d.counted_cash ?? '').trim() !== '';
        const valid = filled && !cashError(d.open_cash) && !cashError(d.counted_cash);
        return (
          <Button
            size="sm" variant="secondary"
            disabled={!valid}
            loading={saveM.isPending && saveM.variables?.date === r.business_date}
            onClick={() => saveRow(r)}
          >
            保存
          </Button>
        );
      },
    },
  ];

  return (
    <div className="space-y-5">
      <Toolbar title="レジ精算" subtitle="営業日ごとの開始現金・実査現金を記録し、現金の過不足を確認する" />

      <Card dense>
        <MonthBar month={month} onChange={setMonth} />
      </Card>

      <Card title="現金過不足の記録" padded={false}>
        {closQ.isError ? (
          <div className="p-3">
            <Alert tone="danger" title="レジ精算を取得できません">{closQ.error?.message}</Alert>
          </div>
        ) : closQ.isLoading ? (
          <div className="p-3"><Skeleton height={240} /></div>
        ) : (
          <DataTable
            columns={COLUMNS}
            rows={rows}
            rowKey={(r) => r.business_date}
            empty={<div className="py-10 text-center text-sm text-muted">この月には現金売上・精算記録がありません。</div>}
            className="border-0 rounded-none"
          />
        )}
      </Card>

      <p className="text-2xs text-muted">
        現金売上はその営業日の会計の現金分(分割会計の現金分を含む・金券は非現金として控除済み)を自動集計。
        過不足 = 実査現金 − (開始現金 + 現金売上)。開始現金と実査現金の両方を入れると保存できます。
      </p>
    </div>
  );
}
