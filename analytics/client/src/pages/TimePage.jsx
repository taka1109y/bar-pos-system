import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Toolbar, Card, Alert, Segmented } from '../components/ui';
import PeriodBar from '../components/period/PeriodBar';
import DataBanner from '../components/DataBanner';
import EChart from '../components/charts/EChart';
import ChartState from '../components/charts/ChartState';
import ExportCsvButton from '../components/ExportCsvButton';
import { usePeriod } from '../utils/period';
import { yen, num } from '../utils/format';
import { api } from '../api';
import {
  PALETTE, baseGrid, catAxis, yenAxis, legend, buildHeatmapOption, hoursRange, hourLabel, DOW_LABELS,
} from '../components/charts/chartTheme';

// 曜日×時間帯分析。ヒートマップ(metric 切替) + 曜日別(合計/1営業日平均) + 時間帯別。
// 時間軸は hour32(営業日モードは境界B..B+23、暦日は0..23)。

const METRICS = [
  { value: 'revenue',  label: '売上' },
  { value: 'quantity', label: '数量' },
  { value: 'orders',   label: '会計数' },
  { value: 'guests',   label: '客数' },
];

const METRIC_FMT = {
  revenue:  (v) => `¥${yen(v)}`,
  quantity: (v) => `${yen(v)} 点`,
  orders:   (v) => `${yen(v)} 件`,
  guests:   (v) => `${yen(v)} 人`,
};

const DOW_MODES = [
  { value: 'total', label: '合計' },
  { value: 'avg',   label: '1営業日平均' },
];

const ITEM_BASED_NOTE = '売上・数量は注文明細(order_items)の注文時刻ベースで、チャージ・深夜料金を含みません。';

export default function TimePage() {
  const { period, isValid } = usePeriod();
  const { start, end, day_mode } = period;
  const [metric, setMetric] = useState('revenue');
  const [dowMode, setDowMode] = useState('total');
  const common = { start, end, day_mode };

  const heatQ = useQuery({
    queryKey: ['v1', 'heatmap', start, end, day_mode, metric],
    queryFn: () => api.getSalesHeatmap({ ...common, metric }),
    enabled: isValid,
  });
  const dowQ = useQuery({
    queryKey: ['v1', 'dow', start, end, day_mode],
    queryFn: () => api.getSalesDow(common),
    enabled: isValid,
  });
  const hourQ = useQuery({
    queryKey: ['v1', 'hourly', start, end, day_mode],
    queryFn: () => api.getSalesHourly(common),
    enabled: isValid,
  });

  const metricLabel = METRICS.find((m) => m.value === metric)?.label || '売上';

  const heatOption = useMemo(() => {
    const d = heatQ.data;
    const hours = hoursRange(day_mode, d?.meta?.boundary_hour);
    return buildHeatmapOption({ cells: d?.cells, hours, max: d?.max, fmt: METRIC_FMT[metric] });
  }, [heatQ.data, day_mode, metric]);

  const dowOption = useMemo(() => {
    const rows = dowQ.data?.rows || [];
    const key = dowMode === 'avg' ? 'avg_revenue_per_open_day' : 'revenue';
    return {
      animation: false,
      grid: baseGrid,
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (ps) => {
          const i = ps?.[0]?.dataIndex ?? 0;
          const r = rows[i] || {};
          return [
            `<div style="font-weight:600">${r.label ?? DOW_LABELS[r.dow] ?? ''}曜</div>`,
            `売上 ¥${yen(r.revenue)}(営業 ${yen(r.open_days)} 日 / 1日平均 ¥${yen(r.avg_revenue_per_open_day)})`,
            `会計 ${yen(r.order_count)} 件 / 客数 ${yen(r.guest_count)} 人 / 客単価 ¥${yen(r.avg_per_guest)}`,
            `数量 ${yen(r.quantity)} 点`,
          ].join('<br/>');
        },
      },
      xAxis: catAxis(rows.map((r) => `${r.label ?? DOW_LABELS[r.dow] ?? ''}`)),
      yAxis: yenAxis(),
      series: [{
        name: dowMode === 'avg' ? '1営業日平均売上' : '売上',
        type: 'bar',
        data: rows.map((r) => Math.round(r[key] || 0)),
        itemStyle: { color: PALETTE.blue, borderRadius: [3, 3, 0, 0] },
        barMaxWidth: 40,
      }],
    };
  }, [dowQ.data, dowMode]);

  const hourOption = useMemo(() => {
    const rows = hourQ.data?.rows || [];
    return {
      animation: false,
      grid: baseGrid,
      legend: legend(),
      tooltip: {
        trigger: 'axis',
        formatter: (ps) => {
          const i = ps?.[0]?.dataIndex ?? 0;
          const r = rows[i] || {};
          return [
            `<div style="font-weight:600">${r.label ?? hourLabel(r.hour32)}</div>`,
            `売上 ¥${yen(r.revenue)} / 数量 ${yen(r.quantity)} 点`,
          ].join('<br/>');
        },
      },
      xAxis: catAxis(rows.map((r) => r.label ?? hourLabel(r.hour32)), { axisLabel: { interval: 1, fontSize: 10 } }),
      yAxis: yenAxis(),
      series: [{
        name: '売上',
        type: 'line',
        data: rows.map((r) => Math.round(r.revenue || 0)),
        itemStyle: { color: PALETTE.blue },
        lineStyle: { color: PALETTE.blue, width: 2 },
        symbolSize: 6,
        areaStyle: { color: 'rgba(43, 112, 239, 0.08)' },
      }],
    };
  }, [hourQ.data]);

  return (
    <div className="space-y-5">
      <Toolbar title="曜日×時間帯" subtitle={`いつ売れているか(${day_mode === 'business' ? '営業日・営業時軸' : '暦日・0〜23時'})`} />
      <DataBanner />
      <Card dense>
        <PeriodBar />
      </Card>

      {!isValid && <Alert tone="warning">期間の指定が不正です。開始は終了以前の日付にしてください。</Alert>}

      <Card
        title={`ヒートマップ(${metricLabel})`}
        dense
        actions={
          <div className="flex items-center gap-2">
            <Segmented size="sm" options={METRICS} value={metric} onChange={setMetric} />
            <ExportCsvButton report="heatmap" params={{ ...common, metric }} />
          </div>
        }
      >
        <ChartState query={heatQ} height={300} isEmpty={(d) => !(d?.cells || []).length} emptyTitle="期間内にデータがありません">
          <EChart option={heatOption} height={300} />
        </ChartState>
        <p className="mt-2 text-2xs text-muted">
          {heatQ.data?.meta?.note || `${metric === 'orders' || metric === 'guests' ? '会計数・客数は会計時刻(closed_at)基準。' : ''}${ITEM_BASED_NOTE}`}
        </p>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <Card
          title="曜日別売上"
          dense
          actions={
            <div className="flex items-center gap-2">
              <Segmented size="sm" options={DOW_MODES} value={dowMode} onChange={setDowMode} />
              <ExportCsvButton report="dow" params={common} />
            </div>
          }
        >
          <ChartState query={dowQ} height={280} isEmpty={(d) => !(d?.rows || []).length} emptyTitle="期間内にデータがありません">
            <EChart option={dowOption} height={280} />
          </ChartState>
          <p className="mt-2 text-2xs text-muted">曜日は営業日(business_date)基準。1営業日平均 = 売上 ÷ その曜日の営業日数。</p>
        </Card>

        <Card title="時間帯別売上" dense actions={<ExportCsvButton report="hourly" params={common} />}>
          <ChartState query={hourQ} height={280} isEmpty={(d) => !(d?.rows || []).length} emptyTitle="期間内にデータがありません">
            <EChart option={hourOption} height={280} />
          </ChartState>
          <p className="mt-2 text-2xs text-muted">{hourQ.data?.meta?.note || ITEM_BASED_NOTE}</p>
        </Card>
      </div>
    </div>
  );
}
