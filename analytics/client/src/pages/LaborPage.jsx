import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Toolbar, Card, Alert, DataTable, StatTile, cn } from '../components/ui';
import PeriodBar from '../components/period/PeriodBar';
import DataBanner from '../components/DataBanner';
import EChart from '../components/charts/EChart';
import ChartState from '../components/charts/ChartState';
import ExportCsvButton from '../components/ExportCsvButton';
import { usePeriod, GRANULARITIES } from '../utils/period';
import { yen, num } from '../utils/format';
import { api } from '../api';
import { PALETTE, baseGrid, catAxis, yenAxis, legend } from '../components/charts/chartTheme';

// 人時生産性(/pl/labor)。GET /api/v1/labor/productivity?start&end&day_mode&granularity。
//
// サーバ側の定義(routes/labor.js)をそのまま画面の注記に反映している:
//   ・労働時間 = シフトの実働分(休憩控除後)の合計。人時売上 = 売上 ÷ 労働時間、
//     人時粗利 = 粗利 ÷ 労働時間(労働時間が0の期間は null → 「—」表示)
//   ・store_settings.include_owner_labor=false ならオーナーのシフトは集計から除外される
//   ・by_hour32 の staff_hours は「在店時間(休憩を差し引かない)」を1時間単位で按分した値で、
//     労働時間(実働)とは分母が違う。revenue も order_items(明細)ベースで、
//     チャージ・深夜料金を含まないため上段の売上とは一致しない
// CSV は /api/v1/export/csv?report=labor_productivity。

const fmtYen = (v) => `¥${yen(v)}`;
const fmtHours = (v) => `${num(v, 1)} h`;
const fmtPct = (v) => (v == null ? '—' : `${num(v, 1)}%`);
const fmtPerHour = (v) => (v == null ? '—' : `¥${yen(v)}`);

// 時間軸(左)。労働時間・人員時間に使う
const hourAxis = (extra = {}) => ({
  type: 'value',
  axisLabel: { color: PALETTE.axis, formatter: (v) => `${v}h` },
  splitLine: { lineStyle: { color: PALETTE.grid } },
  ...extra,
});

export default function LaborPage() {
  const { period, isValid } = usePeriod();
  const { start, end, day_mode, granularity } = period;
  const params = { start, end, day_mode, granularity };

  const laborQ = useQuery({
    queryKey: ['v1', 'labor', 'productivity', start, end, day_mode, granularity],
    queryFn: () => api.getLaborProductivity(params),
    enabled: isValid,
  });

  const summary = laborQ.data?.summary || null;
  const byPeriod = laborQ.data?.by_period || [];
  const byStaff = laborQ.data?.by_staff || [];
  const byHour = laborQ.data?.by_hour32 || [];
  const granularityLabel = GRANULARITIES.find((g) => g.value === granularity)?.label || '日';

  const hasLabor = summary != null && Number(summary.labor_hours) > 0;

  // 期間推移: 棒 = 労働時間(左軸)、線 = 人時売上(右軸)
  const periodOption = useMemo(() => ({
    animation: false,
    grid: { ...baseGrid, right: 56 },
    legend: legend(),
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (ps) => {
        const i = ps?.[0]?.dataIndex ?? 0;
        const r = byPeriod[i] || {};
        return [
          `<div style="font-weight:600">${r.label ?? ''}</div>`,
          `労働時間 ${fmtHours(r.labor_hours)} / 人件費 ¥${yen(r.labor_cost)}`,
          `売上 ¥${yen(r.revenue)} / 人時売上 ${fmtPerHour(r.sales_per_labor_hour)}`,
          `人件費率 ${fmtPct(r.labor_cost_rate)}`,
        ].join('<br/>');
      },
    },
    xAxis: catAxis(byPeriod.map((r) => r.label)),
    yAxis: [hourAxis(), yenAxis({ splitLine: { show: false } })],
    series: [
      {
        name: '労働時間', type: 'bar',
        data: byPeriod.map((r) => Number(r.labor_hours) || 0),
        itemStyle: { color: PALETTE.blue, borderRadius: [3, 3, 0, 0] },
        barMaxWidth: 28,
      },
      {
        name: '人時売上', type: 'line', yAxisIndex: 1,
        data: byPeriod.map((r) => (r.sales_per_labor_hour == null ? null : Math.round(r.sales_per_labor_hour))),
        itemStyle: { color: PALETTE.emerald },
        lineStyle: { color: PALETTE.emerald, width: 2 },
        symbolSize: 6,
        connectNulls: false,
      },
    ],
  }), [byPeriod]);

  // 営業時別: 棒 = 人員時間(在店ベース・左軸)、線 = 売上(明細ベース・右軸)
  const hourOption = useMemo(() => ({
    animation: false,
    grid: { ...baseGrid, right: 56, bottom: 40 },
    legend: legend(),
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (ps) => {
        const i = ps?.[0]?.dataIndex ?? 0;
        const r = byHour[i] || {};
        return [
          `<div style="font-weight:600">${r.label ?? ''}</div>`,
          `人員時間 ${fmtHours(r.staff_hours)}`,
          `売上(明細) ¥${yen(r.revenue)}`,
          `人時売上 ${fmtPerHour(r.sales_per_labor_hour)}`,
        ].join('<br/>');
      },
    },
    xAxis: catAxis(byHour.map((r) => r.label), { axisLabel: { interval: 1, fontSize: 10, color: PALETTE.axis } }),
    yAxis: [hourAxis(), yenAxis({ splitLine: { show: false } })],
    series: [
      {
        name: '人員時間', type: 'bar',
        data: byHour.map((r) => Number(r.staff_hours) || 0),
        itemStyle: { color: PALETTE.violet, borderRadius: [3, 3, 0, 0] },
        barMaxWidth: 20,
      },
      {
        name: '売上(明細)', type: 'line', yAxisIndex: 1,
        data: byHour.map((r) => Math.round(Number(r.revenue) || 0)),
        itemStyle: { color: PALETTE.blue },
        lineStyle: { color: PALETTE.blue, width: 2 },
        symbolSize: 5,
      },
    ],
  }), [byHour]);

  const PERIOD_COLUMNS = [
    {
      key: 'label', header: '期間', width: 120,
      render: (r) => <span className={cn(r._total ? 'font-semibold text-heading' : 'text-heading')}>{r.label}</span>,
    },
    { key: 'labor_hours', header: '労働時間', align: 'right', width: 100, render: (r) => <span className={cn('tabular-nums', r._total && 'font-semibold text-heading')}>{fmtHours(r.labor_hours)}</span> },
    { key: 'labor_cost', header: '人件費', align: 'right', width: 110, render: (r) => <span className={cn('tabular-nums', r._total && 'font-semibold text-heading')}>{fmtYen(r.labor_cost)}</span> },
    { key: 'revenue', header: '売上', align: 'right', width: 120, render: (r) => <span className={cn('tabular-nums', r._total && 'font-semibold text-heading')}>{fmtYen(r.revenue)}</span> },
    { key: 'sales_per_labor_hour', header: '人時売上', align: 'right', width: 110, render: (r) => <span className={cn('tabular-nums', r._total && 'font-semibold text-heading')}>{fmtPerHour(r.sales_per_labor_hour)}</span> },
    { key: 'labor_cost_rate', header: '人件費率', align: 'right', width: 90, render: (r) => <span className={cn('tabular-nums', r._total && 'font-semibold text-heading')}>{fmtPct(r.labor_cost_rate)}</span> },
  ];

  // 期間推移の表(合計行はサーバの summary をそのまま使う。人時売上を単純平均しない)
  const periodTableRows = useMemo(() => {
    if (byPeriod.length === 0 || !summary) return [];
    return [...byPeriod, {
      _total: true,
      label: '合計',
      labor_hours: summary.labor_hours,
      labor_cost: summary.labor_cost,
      revenue: summary.revenue,
      sales_per_labor_hour: summary.sales_per_labor_hour,
      labor_cost_rate: summary.labor_cost_rate,
    }];
  }, [byPeriod, summary]);

  const STAFF_COLUMNS = [
    {
      key: 'name', header: 'スタッフ',
      render: (r) => <span className={cn(r._total ? 'font-semibold text-heading' : 'text-heading font-medium')}>{r.name}</span>,
    },
    { key: 'shift_count', header: 'シフト数', align: 'right', width: 90, render: (r) => <span className={cn('tabular-nums', r._total && 'font-semibold text-heading')}>{yen(r.shift_count)} 回</span> },
    { key: 'labor_hours', header: '労働時間', align: 'right', width: 100, render: (r) => <span className={cn('tabular-nums', r._total && 'font-semibold text-heading')}>{fmtHours(r.labor_hours)}</span> },
    { key: 'labor_cost', header: '人件費', align: 'right', width: 110, render: (r) => <span className={cn('tabular-nums', r._total && 'font-semibold text-heading')}>{fmtYen(r.labor_cost)}</span> },
    {
      key: 'share', header: '時間構成比', align: 'right', width: 100,
      render: (r) => <span className={cn('tabular-nums', r._total ? 'font-semibold text-heading' : 'text-muted')}>{fmtPct(r.share_pct)}</span>,
    },
  ];

  const staffTableRows = useMemo(() => {
    if (byStaff.length === 0) return [];
    const totalHours = byStaff.reduce((a, r) => a + (Number(r.labor_hours) || 0), 0);
    const withShare = byStaff.map((r) => ({
      ...r,
      share_pct: totalHours > 0 ? (Number(r.labor_hours) / totalHours) * 100 : null,
    }));
    return [...withShare, {
      _total: true,
      staff_id: 'total',
      name: '合計',
      shift_count: byStaff.reduce((a, r) => a + (Number(r.shift_count) || 0), 0),
      labor_hours: totalHours,
      labor_cost: byStaff.reduce((a, r) => a + (Number(r.labor_cost) || 0), 0),
      share_pct: totalHours > 0 ? 100 : null,
    }];
  }, [byStaff]);

  return (
    <div className="space-y-5">
      <Toolbar
        title="人時生産性"
        subtitle={`労働1時間あたりの売上・粗利と人件費率(${day_mode === 'business' ? '営業日' : '暦日'}ベース)`}
      >
        <ExportCsvButton report="labor_productivity" params={params} />
      </Toolbar>
      <DataBanner />
      <Card dense>
        <PeriodBar />
      </Card>

      {!isValid && <Alert tone="warning">期間の指定が不正です。開始は終了以前の日付にしてください。</Alert>}
      {!laborQ.isLoading && !laborQ.isError && summary && !hasLabor && (
        <Alert tone="info" title="この期間のシフトが登録されていません">
          労働時間が0のため人時売上・人時粗利・人件費率は計算できません。「スタッフ・シフト」でシフトを登録してください。
        </Alert>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatTile dense label="人時売上" value={summary ? fmtPerHour(summary.sales_per_labor_hour) : '—'} sub="売上 ÷ 労働時間" />
        <StatTile dense label="人時粗利" value={summary ? fmtPerHour(summary.gross_profit_per_labor_hour) : '—'} sub="粗利 ÷ 労働時間" />
        <StatTile dense label="人件費率" value={summary ? fmtPct(summary.labor_cost_rate) : '—'} sub={summary ? `売上 ¥${yen(summary.revenue)}` : undefined} />
        <StatTile dense label="総労働時間" value={summary ? fmtHours(summary.labor_hours) : '—'} sub="休憩を除いた実働の合計" />
        <StatTile dense label="人件費" value={summary ? fmtYen(summary.labor_cost) : '—'} sub="実働分 × 時給スナップショット" />
      </div>

      <Card title={`${granularityLabel}次の労働時間と人時売上`} dense>
        <ChartState query={laborQ} height={320} isEmpty={(d) => !(d?.by_period || []).length} emptyTitle="期間内にデータがありません">
          <EChart option={periodOption} height={320} />
        </ChartState>
        <p className="mt-2 text-2xs text-muted">
          棒 = 労働時間(実働・左軸)、線 = 人時売上(右軸)。労働時間が0の期間は人時売上を表示しません(線が途切れます)。
        </p>
      </Card>

      <Card title="期間別の明細" padded={false}>
        <ChartState query={laborQ} height={200} isEmpty={(d) => !(d?.by_period || []).length} emptyTitle="期間内にデータがありません">
          <DataTable
            columns={PERIOD_COLUMNS}
            rows={periodTableRows}
            rowKey={(r, i) => (r._total ? 'total' : r.period_start || i)}
            className="border-0 rounded-none"
          />
        </ChartState>
      </Card>

      <Card title="スタッフ別" padded={false}>
        <ChartState query={laborQ} height={200} isEmpty={(d) => !(d?.by_staff || []).length} emptyTitle="期間内にシフトが登録されていません">
          <DataTable
            columns={STAFF_COLUMNS}
            rows={staffTableRows}
            rowKey={(r) => (r._total ? 'total' : r.staff_id)}
            className="border-0 rounded-none"
          />
        </ChartState>
        <p className="px-3 py-2 text-2xs text-muted border-t border-line">
          労働時間は休憩を差し引いた実働、人件費はシフト時点の時給スナップショットで計算しています。
          店舗設定の「オーナーの人件費を含める」が OFF のとき、雇用区分がオーナーのシフトは集計から除外されます。
        </p>
      </Card>

      <Card title="営業時間帯別の人員配置" dense>
        <ChartState query={laborQ} height={320} isEmpty={(d) => !(d?.by_hour32 || []).length} emptyTitle="期間内にデータがありません">
          <EChart option={hourOption} height={320} />
        </ChartState>
        <p className="mt-2 text-2xs text-muted">
          棒 = 人員時間(左軸)、線 = 売上(右軸)。
          <span className="font-medium text-body">人員時間は在店時間(休憩を差し引かない)を1時間単位で按分した値</span>
          で、上の労働時間(実働)とは分母が違います。売上は order_items(明細)ベースのため、チャージ・深夜料金を含まず上段の売上とは一致しません。
        </p>
      </Card>
    </div>
  );
}
