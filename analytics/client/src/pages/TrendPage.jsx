import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Toolbar, Card, Alert, DataTable, cn } from '../components/ui';
import PeriodBar from '../components/period/PeriodBar';
import DataBanner from '../components/DataBanner';
import EChart from '../components/charts/EChart';
import ChartState from '../components/charts/ChartState';
import ExportCsvButton from '../components/ExportCsvButton';
import PrintButton from '../components/PrintButton';
import { usePeriod, COMPARE_LABELS, GRANULARITIES } from '../utils/period';
import { yen, num } from '../utils/format';
import { api } from '../api';
import { PALETTE, baseGrid, catAxis, yenAxis, pctAxis, legend } from '../components/charts/chartTheme';

// 売上推移。PeriodBar の粒度(日/週/月/年度)・比較(前期間/前週/前年同日/前年同曜日)がそのまま効く。
// チャート: 売上(棒) + 粗利率(線・右軸) + 比較期間の売上(点線・参照色)。
// 表: 全バケット + 合計行。CSV は /api/v1/export/csv?report=trend。

// 数値セル(右寄せ・合計行は強調)
const numCol = (key, header, fmt, width) => ({
  key, header, width, align: 'right',
  render: (r) => (
    <span className={cn('tabular-nums', r._total && 'font-semibold text-heading')}>{fmt(r[key], r)}</span>
  ),
});

const fmtYen = (v) => `¥${yen(v)}`;
const fmtCount = (v) => yen(v);
const fmtPct = (v) => (v == null ? '—' : `${num(v, 1)}%`);

const COLUMNS = [
  {
    key: 'label', header: '期間', width: 120,
    render: (r) => <span className={cn(r._total ? 'font-semibold text-heading' : 'text-heading')}>{r.label}</span>,
  },
  numCol('revenue', '売上', fmtYen),
  numCol('total_cost', '原価', fmtYen),
  numCol('gross_profit', '粗利', fmtYen),
  numCol('gross_profit_rate', '粗利率', fmtPct, 80),
  numCol('order_count', '会計', fmtCount, 70),
  numCol('guest_count', '客数', fmtCount, 70),
  numCol('item_count', '点数', fmtCount, 70),
  numCol('avg_per_guest', '客単価', fmtYen, 90),
];

export default function TrendPage() {
  const { period, isValid } = usePeriod();
  const { start, end, day_mode, granularity, compare } = period;
  const params = { start, end, day_mode, granularity, ...(compare ? { compare } : {}) };

  const trendQ = useQuery({
    queryKey: ['v1', 'trend', start, end, day_mode, granularity, compare],
    queryFn: () => api.getSalesTrend(params),
    enabled: isValid,
  });

  const rows = trendQ.data?.rows || [];
  const cmpRows = trendQ.data?.compare_rows || [];
  const cmpLabel = COMPARE_LABELS[compare] || '比較';
  const granularityLabel = GRANULARITIES.find((g) => g.value === granularity)?.label || '日';

  const option = useMemo(() => {
    const series = [
      {
        name: '売上', type: 'bar',
        data: rows.map((r) => Math.round(r.revenue || 0)),
        itemStyle: { color: PALETTE.blue, borderRadius: [3, 3, 0, 0] },
        barMaxWidth: 28,
      },
      {
        name: '粗利率', type: 'line', yAxisIndex: 1,
        data: rows.map((r) => (r.gross_profit_rate == null ? null : Math.round(Number(r.gross_profit_rate) * 10) / 10)),
        itemStyle: { color: PALETTE.emerald },
        lineStyle: { color: PALETTE.emerald, width: 2 },
        symbolSize: 6,
      },
    ];
    if (cmpRows.length > 0) {
      series.push({
        name: `売上(${cmpLabel})`, type: 'line',
        data: rows.map((_, i) => (cmpRows[i] ? Math.round(cmpRows[i].revenue || 0) : null)),
        itemStyle: { color: PALETTE.muted },
        lineStyle: { color: PALETTE.muted, width: 2, type: 'dashed' },
        symbolSize: 5,
      });
    }
    return {
      animation: false,
      grid: { ...baseGrid, right: 48 },
      legend: legend(),
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (ps) => {
          const i = ps?.[0]?.dataIndex ?? 0;
          const r = rows[i] || {};
          const cr = cmpRows[i];
          const lines = [
            `<div style="font-weight:600">${r.label ?? ''}</div>`,
            `売上 ¥${yen(r.revenue)} / 粗利 ¥${yen(r.gross_profit)}(${num(r.gross_profit_rate, 1)}%)`,
            `会計 ${yen(r.order_count)} 件 / 客数 ${yen(r.guest_count)} 人 / 客単価 ¥${yen(r.avg_per_guest)}`,
          ];
          if (cr) lines.push(`${cmpLabel}(${cr.label ?? ''}) 売上 ¥${yen(cr.revenue)}`);
          return lines.join('<br/>');
        },
      },
      xAxis: catAxis(rows.map((r) => r.label)),
      yAxis: [yenAxis(), pctAxis()],
      series,
    };
  }, [rows, cmpRows, cmpLabel]);

  // 表(合計行つき)。粗利率・客単価は合計から再計算する(単純平均にしない)。
  const tableRows = useMemo(() => {
    if (rows.length === 0) return [];
    const sum = (k) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
    const revenue = sum('revenue');
    const cost = sum('total_cost');
    const gp = sum('gross_profit');
    const guests = sum('guest_count');
    return [...rows, {
      _total: true,
      label: '合計',
      revenue,
      total_cost: cost,
      gross_profit: gp,
      gross_profit_rate: revenue > 0 ? (gp / revenue) * 100 : null,
      order_count: sum('order_count'),
      guest_count: guests,
      item_count: sum('item_count'),
      avg_per_guest: guests > 0 ? revenue / guests : 0,
    }];
  }, [rows]);

  return (
    <div className="space-y-5">
      <Toolbar title="推移" subtitle={`売上・粗利の${granularityLabel}次推移(${day_mode === 'business' ? '営業日' : '暦日'}ベース)`}>
        <ExportCsvButton report="trend" params={params} />
        <PrintButton />
      </Toolbar>
      <DataBanner />
      <Card dense>
        <PeriodBar />
      </Card>

      {!isValid && <Alert tone="warning">期間の指定が不正です。開始は終了以前の日付にしてください。</Alert>}
      {compare && !trendQ.isLoading && !trendQ.isError && cmpRows.length === 0 && (
        <Alert tone="info">比較期間({cmpLabel})のデータがありません。</Alert>
      )}

      <Card title={`${granularityLabel}次推移`} dense>
        <ChartState query={trendQ} height={320} isEmpty={(d) => !(d?.rows || []).length} emptyTitle="期間内に会計データがありません">
          <EChart option={option} height={320} />
        </ChartState>
        <p className="mt-2 text-2xs text-muted">期間内の全バケットを0埋めで表示。取消し(void/black_cancelled)は除外。</p>
      </Card>

      <Card title="明細" padded={false}>
        <ChartState query={trendQ} height={200} isEmpty={(d) => !(d?.rows || []).length} emptyTitle="期間内に会計データがありません">
          <DataTable
            columns={COLUMNS}
            rows={tableRows}
            rowKey={(r, i) => (r._total ? 'total' : r.period_start || i)}
            className="border-0 rounded-none"
          />
        </ChartState>
      </Card>
    </div>
  );
}
