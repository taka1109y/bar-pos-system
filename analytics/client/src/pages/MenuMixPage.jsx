import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Toolbar, Card, Alert, DataTable, Field, Segmented, cn } from '../components/ui';
import PeriodBar from '../components/period/PeriodBar';
import DataBanner from '../components/DataBanner';
import EChart from '../components/charts/EChart';
import ChartState from '../components/charts/ChartState';
import ExportCsvButton from '../components/ExportCsvButton';
import { usePeriod } from '../utils/period';
import { yen, num } from '../utils/format';
import { api } from '../api';
import { PALETTE, SERIES10, legend } from '../components/charts/chartTheme';

// メニューミックス。by(カテゴリ/サブカテゴリ/ドリンク・フード/税率/通常・裏)で売上構成を
// ドーナツ + 構成比バー付きの表で表示する。集計は order_items(明細)ベース。

const BY_OPTIONS = [
  { value: 'category',     label: 'カテゴリ' },
  { value: 'subcategory',  label: 'サブカテゴリ' },
  { value: 'drink_food',   label: 'ドリンク/フード' },
  { value: 'tax_category', label: '税率' },
  { value: 'staff_only',   label: '通常/裏メニュー' },
];

const cell = (r, text) => <span className={cn('tabular-nums', r._total && 'font-semibold text-heading')}>{text}</span>;

const COLUMNS = [
  {
    key: 'name', header: '区分',
    render: (r) => <span className={cn('text-heading', r._total && 'font-semibold')}>{r.name}</span>,
  },
  { key: 'quantity', header: '数量', align: 'right', width: 80, render: (r) => cell(r, yen(r.quantity)) },
  { key: 'revenue', header: '売上', align: 'right', render: (r) => cell(r, `¥${yen(r.revenue)}`) },
  {
    key: 'share_pct', header: '構成比', width: 200,
    render: (r) => (
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 rounded-full bg-surface-sunken overflow-hidden">
          <div
            className="h-full rounded-full bg-primary-500"
            style={{ width: `${Math.max(0, Math.min(100, Number(r.share_pct) || 0))}%` }}
          />
        </div>
        <span className={cn('tabular-nums text-xs w-12 text-right', r._total && 'font-semibold text-heading')}>
          {num(r.share_pct, 1)}%
        </span>
      </div>
    ),
  },
  { key: 'gross_profit', header: '粗利', align: 'right', render: (r) => cell(r, `¥${yen(r.gross_profit)}`) },
  {
    key: 'gross_profit_rate', header: '粗利率', align: 'right', width: 80,
    render: (r) => cell(r, r.gross_profit_rate == null ? '—' : `${num(r.gross_profit_rate, 1)}%`),
  },
];

export default function MenuMixPage() {
  const { period, isValid } = usePeriod();
  const { start, end, day_mode } = period;
  const [by, setBy] = useState('category');
  const common = { start, end, day_mode };

  const mixQ = useQuery({
    queryKey: ['v1', 'products', 'mix', start, end, day_mode, by],
    queryFn: () => api.getProductsMix({ ...common, by }),
    enabled: isValid,
  });

  const rows = mixQ.data?.rows || [];
  const byLabel = BY_OPTIONS.find((o) => o.value === by)?.label || 'カテゴリ';

  const pieOption = useMemo(() => {
    const sorted = rows.slice().sort((a, b) => (Number(b.revenue) || 0) - (Number(a.revenue) || 0));
    return {
      animation: false,
      color: SERIES10,
      tooltip: { trigger: 'item', formatter: (p) => `${p.name}: ¥${yen(p.value)} (${num(p.percent, 1)}%)` },
      legend: legend({ top: 'auto', bottom: 0, left: 'center', type: 'scroll' }),
      series: [{
        type: 'pie', radius: ['55%', '78%'], center: ['50%', '45%'],
        data: sorted.map((r) => ({ name: r.name, value: Math.round(r.revenue || 0) })),
        itemStyle: { borderColor: PALETTE.surface, borderWidth: 2 },
        label: { show: false },
        emphasis: { scaleSize: 4 },
      }],
    };
  }, [rows]);

  // 表(合計行つき)。粗利率は合計から再計算する(単純平均にしない)
  const tableRows = useMemo(() => {
    if (rows.length === 0) return [];
    const sum = (k) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
    const revenue = sum('revenue');
    const gp = sum('gross_profit');
    return [...rows, {
      _total: true,
      name: '合計',
      quantity: sum('quantity'),
      revenue,
      total_cost: sum('total_cost'),
      gross_profit: gp,
      gross_profit_rate: revenue > 0 ? (gp / revenue) * 100 : null,
      share_pct: 100,
    }];
  }, [rows]);

  return (
    <div className="space-y-5">
      <Toolbar title="メニューミックス" subtitle={`${byLabel}別の売上構成(${day_mode === 'business' ? '営業日' : '暦日'}ベース)`}>
        <ExportCsvButton report="mix" params={{ ...common, by }} />
      </Toolbar>
      <DataBanner />
      <Card dense>
        <PeriodBar />
      </Card>

      {!isValid && <Alert tone="warning">期間の指定が不正です。開始は終了以前の日付にしてください。</Alert>}

      <Card dense>
        <Field label="集計軸">
          <Segmented options={BY_OPTIONS} value={by} onChange={setBy} />
        </Field>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <Card title={`${byLabel}別構成比(売上)`} dense>
          <ChartState query={mixQ} height={300} isEmpty={(d) => !(d?.rows || []).some((r) => Number(r.revenue) > 0)}>
            <EChart option={pieOption} height={300} />
          </ChartState>
        </Card>
        <Card title={`${byLabel}別明細`} padded={false} className="xl:col-span-2">
          <ChartState query={mixQ} height={300} isEmpty={(d) => !(d?.rows || []).length}>
            <DataTable
              columns={COLUMNS}
              rows={tableRows}
              rowKey={(r, i) => (r._total ? '_total' : `${r.key ?? r.name ?? i}`)}
              className="border-0 rounded-none"
            />
          </ChartState>
        </Card>
      </div>

      <p className="text-2xs text-muted">
        売上・粗利は order_items(明細)ベースで、チャージ・深夜料金を含みません。取消し(void/black_cancelled)は除外。
      </p>
    </div>
  );
}
