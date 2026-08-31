import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { Toolbar, Card, Alert, Button, Field, Input, FilterBar, StatTile, DataTable, Skeleton, cn } from '../components/ui';
import PeriodBar from '../components/period/PeriodBar';
import DataBanner from '../components/DataBanner';
import { usePeriod } from '../utils/period';
import { yen, num } from '../utils/format';
import { api } from '../api';

// 期間比較。期間A/B を日付4つで指定し、summary の全数値指標を並べて増減%を見る。
// プリセット: 前期間(同日数手前) / 前月同期間 / 前年同期間。
// day_mode は上の PeriodBar の「日付の基準」に従う。

const FMT = 'YYYY-MM-DD';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 比較表に出す指標(summary の数値キー)。diff は `${key}_change_pct` を参照する。
const METRICS = [
  { key: 'total_revenue',        label: '売上',        fmt: (v) => `¥${yen(v)}` },
  { key: 'gross_profit',         label: '粗利',        fmt: (v) => `¥${yen(v)}` },
  { key: 'gross_profit_rate',    label: '粗利率',      fmt: (v) => `${num(v, 1)}%` },
  { key: 'total_cost',           label: '原価',        fmt: (v) => `¥${yen(v)}` },
  { key: 'order_count',          label: '会計件数',    fmt: (v) => `${yen(v)} 件` },
  { key: 'guest_count',          label: '客数',        fmt: (v) => `${yen(v)} 人` },
  { key: 'avg_order_value',      label: '会計単価',    fmt: (v) => `¥${yen(v)}` },
  { key: 'avg_per_guest',        label: '客単価',      fmt: (v) => `¥${yen(v)}` },
  { key: 'avg_stay_minutes',     label: '平均滞在',    fmt: (v) => `${yen(v)} 分` },
  { key: 'total_item_count',     label: '販売点数',    fmt: (v) => `${yen(v)} 点` },
  { key: 'open_days',            label: '営業日数',    fmt: (v) => `${yen(v)} 日` },
  { key: 'revenue_per_open_day', label: '1営業日平均', fmt: (v) => `¥${yen(v)}` },
  { key: 'total_charge',         label: 'チャージ',    fmt: (v) => `¥${yen(v)}` },
  { key: 'total_discount',       label: '割引',        fmt: (v) => `¥${yen(v)}` },
];

function DiffPct({ v }) {
  if (v == null || !Number.isFinite(Number(v))) return <span className="text-faint">—</span>;
  const p = Number(v);
  const tone = p > 0 ? 'text-success' : p < 0 ? 'text-danger' : 'text-muted';
  const arrow = p > 0 ? '▲' : p < 0 ? '▼' : '±';
  return <span className={cn('font-medium tabular-nums', tone)}>{arrow} {p > 0 ? '+' : ''}{num(p, 1)}%</span>;
}

// A と同じ日数だけ手前の期間
function prevPeriodOf(start, end) {
  const days = dayjs(end).diff(dayjs(start), 'day') + 1;
  return { start: dayjs(start).subtract(days, 'day').format(FMT), end: dayjs(end).subtract(days, 'day').format(FMT) };
}

export default function ComparePage() {
  const { period } = usePeriod();
  const { day_mode } = period;
  const [a, setA] = useState({ start: period.start, end: period.end });
  const [b, setB] = useState(() => prevPeriodOf(period.start, period.end));

  const aValid = DATE_RE.test(a.start) && DATE_RE.test(a.end) && a.start <= a.end;
  const bValid = DATE_RE.test(b.start) && DATE_RE.test(b.end) && b.start <= b.end;

  const cmpQ = useQuery({
    queryKey: ['v1', 'compare', a.start, a.end, b.start, b.end, day_mode],
    queryFn: () => api.getSalesCompare({ a_start: a.start, a_end: a.end, b_start: b.start, b_end: b.end, day_mode }),
    enabled: aValid && bValid,
  });

  const d = cmpQ.data;
  const sa = d?.a?.summary;
  const sb = d?.b?.summary;

  const presets = [
    { label: '前期間', apply: () => setB(prevPeriodOf(a.start, a.end)) },
    { label: '前月同期間', apply: () => setB({ start: dayjs(a.start).subtract(1, 'month').format(FMT), end: dayjs(a.end).subtract(1, 'month').format(FMT) }) },
    { label: '前年同期間', apply: () => setB({ start: dayjs(a.start).subtract(1, 'year').format(FMT), end: dayjs(a.end).subtract(1, 'year').format(FMT) }) },
  ];

  const rows = useMemo(() => {
    if (!sa || !sb) return [];
    return METRICS.map((m) => ({
      key: m.key,
      label: m.label,
      a: m.fmt(sa[m.key]),
      b: m.fmt(sb[m.key]),
      diff: d?.diff?.[`${m.key}_change_pct`],
    }));
  }, [sa, sb, d]);

  const COLUMNS = [
    { key: 'label', header: '指標', render: (r) => <span className="text-heading font-medium">{r.label}</span> },
    { key: 'a', header: `期間A(${a.start}〜${a.end})`, align: 'right', render: (r) => <span className="tabular-nums text-heading">{r.a}</span> },
    { key: 'b', header: `期間B(${b.start}〜${b.end})`, align: 'right', render: (r) => <span className="tabular-nums">{r.b}</span> },
    { key: 'diff', header: 'A vs B', align: 'right', width: 110, render: (r) => <DiffPct v={r.diff} /> },
  ];

  const kpi = (s, other) => [
    { label: '売上', value: s ? `¥${yen(s.total_revenue)}` : '—' },
    { label: '粗利', value: s ? `¥${yen(s.gross_profit)}` : '—', sub: s ? `${num(s.gross_profit_rate, 1)}%` : undefined },
    { label: '客数', value: s ? `${yen(s.guest_count)} 人` : '—' },
    { label: '客単価', value: s ? `¥${yen(s.avg_per_guest)}` : '—', sub: other },
  ];

  return (
    <div className="space-y-5">
      <Toolbar title="期間比較" subtitle={`任意の2期間の実績を並べて比較(${day_mode === 'business' ? '営業日' : '暦日'}ベース)`} />
      <DataBanner />
      <Card dense>
        <PeriodBar />
        <p className="mt-2 text-2xs text-muted">この画面では上のバーは「日付の基準」だけが効きます。比較する期間は下の A/B で指定してください。</p>
      </Card>

      <Card dense title="比較期間の指定">
        <FilterBar>
          <Field label="期間A 開始" htmlFor="cmp-a-start" className="w-40" error={!aValid ? '開始は終了以前に' : undefined}>
            <Input id="cmp-a-start" type="date" value={a.start} invalid={!aValid} onChange={(e) => e.target.value && setA({ ...a, start: e.target.value })} />
          </Field>
          <Field label="期間A 終了" htmlFor="cmp-a-end" className="w-40">
            <Input id="cmp-a-end" type="date" value={a.end} invalid={!aValid} onChange={(e) => e.target.value && setA({ ...a, end: e.target.value })} />
          </Field>
          <Field label="期間B 開始" htmlFor="cmp-b-start" className="w-40" error={!bValid ? '開始は終了以前に' : undefined}>
            <Input id="cmp-b-start" type="date" value={b.start} invalid={!bValid} onChange={(e) => e.target.value && setB({ ...b, start: e.target.value })} />
          </Field>
          <Field label="期間B 終了" htmlFor="cmp-b-end" className="w-40">
            <Input id="cmp-b-end" type="date" value={b.end} invalid={!bValid} onChange={(e) => e.target.value && setB({ ...b, end: e.target.value })} />
          </Field>
          <div className="leading-normal flex items-center gap-2">
            {presets.map((p) => (
              <Button key={p.label} variant="secondary" onClick={p.apply}>{p.label}</Button>
            ))}
          </div>
        </FilterBar>
        <p className="mt-2 text-2xs text-muted">プリセットは期間Aを基準に期間Bを設定します。</p>
      </Card>

      {cmpQ.isError && <Alert tone="danger" title="比較を取得できません">{cmpQ.error?.message}</Alert>}

      {cmpQ.isLoading && aValid && bValid ? (
        <Skeleton height={320} />
      ) : sa && sb ? (
        <>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            <Card title={`期間A: ${d.a.start}〜${d.a.end}`} dense>
              <div className="grid grid-cols-2 gap-3">
                {kpi(sa).map((t) => <StatTile key={t.label} dense label={t.label} value={t.value} sub={t.sub} />)}
              </div>
            </Card>
            <Card title={`期間B: ${d.b.start}〜${d.b.end}`} dense>
              <div className="grid grid-cols-2 gap-3">
                {kpi(sb).map((t) => <StatTile key={t.label} dense label={t.label} value={t.value} sub={t.sub} />)}
              </div>
            </Card>
          </div>
          <Card title="指標別の増減(A vs B)" padded={false}>
            <DataTable columns={COLUMNS} rows={rows} rowKey={(r) => r.key} className="border-0 rounded-none" />
          </Card>
        </>
      ) : null}
    </div>
  );
}
