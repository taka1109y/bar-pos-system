import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Toolbar, Card, Alert, DataTable, Badge, Field, Input, StatTile } from '../components/ui';
import PeriodBar from '../components/period/PeriodBar';
import DataBanner from '../components/DataBanner';
import EChart from '../components/charts/EChart';
import ChartState from '../components/charts/ChartState';
import ExportCsvButton from '../components/ExportCsvButton';
import { usePeriod } from '../utils/period';
import { todayJST } from '../utils/tz';
import { yen, num } from '../utils/format';
import { api } from '../api';
import { PALETTE, baseGrid, catAxis, yenShort, hourLabel } from '../components/charts/chartTheme';

// 席稼働・回転。卓別の組数・客数・売上・平均滞在・回転(1営業日あたり)・席稼働率と、
// 1営業日分の卓別タイムライン(ガント)を見る。
// 稼働率 = 客数 ÷ (席数 × 営業日数)。席数は「席数入力」(/inputs/seats)で設定した analyticsdb の値。
// 席数未設定(seats=null)と即会計テーブルは稼働率の計算対象外。100%超は実値のまま warning 表示する。
// CSV は /api/v1/export/csv?report=seats_utilization。

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TYPE_LABELS = { table: 'テーブル', counter: 'カウンター', immediate: '即会計' };

// hour32(小数) → "26:30(翌2:30)" 形式
function hm(h) {
  const n = Number(h);
  if (!Number.isFinite(n)) return '—';
  const hh = Math.floor(n);
  const mm = String(Math.round((n - hh) * 60)).padStart(2, '0');
  return hh >= 24 ? `${hh}:${mm}(翌${hh - 24}:${mm})` : `${hh}:${mm}`;
}

export default function SeatsUtilizationPage() {
  const { period, isValid } = usePeriod();
  const { start, end, day_mode } = period;
  const [date, setDate] = useState(() => todayJST());

  const params = { start, end, day_mode };
  const utilQ = useQuery({
    queryKey: ['v1', 'seats', 'utilization', start, end, day_mode],
    queryFn: () => api.getSeatsUtilization(params),
    enabled: isValid,
  });
  const timelineQ = useQuery({
    queryKey: ['v1', 'seats', 'timeline', date, day_mode],
    queryFn: () => api.getSeatsTimeline({ date, day_mode }),
    enabled: DATE_RE.test(date),
  });

  const rows = utilQ.data?.rows || [];
  const totals = utilQ.data?.totals;
  const openDays = utilQ.data?.open_days;

  // 卓別売上の横棒(実績のある卓のみ)。昇順に並べると ECharts の category yAxis で最大が最上段になる
  const chartRows = useMemo(
    () => rows.filter((r) => Number(r.order_count) > 0).slice().sort((a, b) => a.revenue - b.revenue),
    [rows]
  );

  const barOption = useMemo(() => ({
    animation: false,
    grid: { ...baseGrid, left: 96 },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (ps) => {
        const i = ps?.[0]?.dataIndex ?? 0;
        const r = chartRows[i] || {};
        return [
          `<div style="font-weight:600">${r.table_name ?? ''}</div>`,
          `売上 ¥${yen(r.revenue)} / ${yen(r.order_count)} 組 / ${yen(r.guest_count)} 人`,
          r.seat_utilization_pct != null ? `席稼働率 ${num(r.seat_utilization_pct, 1)}%` : '席稼働率 —',
        ].join('<br/>');
      },
    },
    xAxis: {
      type: 'value',
      axisLabel: { color: PALETTE.axis, formatter: yenShort },
      splitLine: { lineStyle: { color: PALETTE.grid } },
    },
    yAxis: catAxis(chartRows.map((r) => r.table_name)),
    series: [{
      name: '売上', type: 'bar',
      data: chartRows.map((r) => Math.round(r.revenue || 0)),
      itemStyle: { color: PALETTE.blue, borderRadius: [0, 3, 3, 0] },
      barMaxWidth: 22,
    }],
  }), [chartRows]);

  // タイムライン(ガント)用: 卓ごとに区間をまとめ、表示レンジ(整数hour32)を決める
  const gantt = useMemo(() => {
    const intervals = (timelineQ.data?.intervals || [])
      .filter((iv) => iv.opened_hour32 != null && iv.closed_hour32 != null);
    if (intervals.length === 0) return null;
    const tables = [];
    const map = new Map();
    for (const iv of intervals) {
      if (!map.has(iv.table_id)) {
        const t = { table_id: iv.table_id, table_name: iv.table_name, bars: [] };
        map.set(iv.table_id, t);
        tables.push(t);
      }
      map.get(iv.table_id).bars.push(iv);
    }
    const minH = Math.floor(Math.min(...intervals.map((iv) => iv.opened_hour32)));
    const maxH = Math.ceil(Math.max(...intervals.map((iv) => Math.max(iv.closed_hour32, iv.opened_hour32 + 0.1))));
    const span = Math.max(1, maxH - minH);
    const step = span > 12 ? 2 : 1;
    const hours = [];
    for (let h = minH; h <= maxH; h += step) hours.push(h);
    return { tables, minH, maxH, span, hours };
  }, [timelineQ.data]);

  const pos = (h) => ((h - gantt.minH) / gantt.span) * 100;

  const COLUMNS = [
    {
      key: 'table_name', header: '卓',
      render: (r) => (
        <span className="inline-flex items-center gap-1.5">
          <span className="text-heading font-medium">{r.table_name}</span>
          <Badge tone="neutral" size="sm">{TYPE_LABELS[r.table_type] || r.table_type}</Badge>
          {r.is_active === false && <Badge tone="neutral" size="sm">停止中</Badge>}
        </span>
      ),
    },
    {
      key: 'seats', header: '席数', align: 'right', width: 90,
      render: (r) => (r.table_type === 'immediate'
        ? <span className="text-faint">—</span>
        : r.seats == null
          ? <Badge tone="warning" size="sm">未設定</Badge>
          : <span className="tabular-nums">{yen(r.seats)}</span>),
    },
    { key: 'order_count', header: '組数', align: 'right', width: 70, render: (r) => <span className="tabular-nums">{yen(r.order_count)}</span> },
    { key: 'guest_count', header: '客数', align: 'right', width: 70, render: (r) => <span className="tabular-nums">{yen(r.guest_count)}</span> },
    { key: 'revenue', header: '売上', align: 'right', render: (r) => <span className="tabular-nums">¥{yen(r.revenue)}</span> },
    {
      key: 'avg_stay_minutes', header: '平均滞在', align: 'right', width: 90,
      render: (r) => (r.avg_stay_minutes == null ? <span className="text-faint">—</span> : <span className="tabular-nums">{yen(r.avg_stay_minutes)} 分</span>),
    },
    {
      key: 'turnover_per_open_day', header: '回転/営業日', align: 'right', width: 100,
      render: (r) => (r.turnover_per_open_day == null ? <span className="text-faint">—</span> : <span className="tabular-nums">{num(r.turnover_per_open_day, 1)}</span>),
    },
    {
      key: 'seat_utilization_pct', header: '席稼働率', align: 'right', width: 110,
      render: (r) => {
        if (r.table_type === 'immediate') return <span className="text-faint">—</span>;
        if (r.seat_utilization_pct == null) {
          return r.seats == null ? <Badge tone="warning" size="sm">席数未設定</Badge> : <span className="text-faint">—</span>;
        }
        const v = Number(r.seat_utilization_pct);
        return v > 100
          ? <Badge tone="warning">{num(v, 1)}%</Badge>
          : <span className="tabular-nums">{num(v, 1)}%</span>;
      },
    },
  ];

  return (
    <div className="space-y-5">
      <Toolbar title="席稼働・回転" subtitle={`卓別の稼働状況と1日のタイムライン(${day_mode === 'business' ? '営業日' : '暦日'}ベース)`}>
        <ExportCsvButton report="seats_utilization" params={params} />
      </Toolbar>
      <DataBanner />
      <Card dense>
        <PeriodBar />
      </Card>

      {!isValid && <Alert tone="warning">期間の指定が不正です。開始は終了以前の日付にしてください。</Alert>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatTile dense label="営業日数" value={openDays != null ? `${yen(openDays)} 日` : '—'} sub="会計が1件以上あった営業日" />
        <StatTile dense label="会計組数" value={totals ? `${yen(totals.order_count)} 組` : '—'} />
        <StatTile dense label="総客数" value={totals ? `${yen(totals.guest_count)} 人` : '—'} />
        <StatTile dense label="売上" value={totals ? `¥${yen(totals.revenue)}` : '—'} />
      </div>

      <Card title="卓別売上" dense>
        <ChartState query={utilQ} height={280} isEmpty={() => chartRows.length === 0} emptyTitle="期間内に会計データがありません">
          <EChart option={barOption} height={Math.max(220, chartRows.length * 30 + 70)} />
        </ChartState>
        <p className="mt-2 text-2xs text-muted">期間内に会計のあった卓のみ表示。取消し(void/black_cancelled)は除外。</p>
      </Card>

      <Card title="卓別の稼働・回転" padded={false}>
        <ChartState query={utilQ} height={200} isEmpty={(d) => !(d?.rows || []).length} emptyTitle="卓が登録されていません">
          <DataTable columns={COLUMNS} rows={rows} rowKey={(r) => r.table_id} className="border-0 rounded-none" />
        </ChartState>
        <p className="px-3 py-2 text-2xs text-muted border-t border-line">
          席稼働率 = 客数 ÷ (席数 × 営業日数)。席数は「席数入力」で設定します(未設定・即会計は計算対象外)。
          回転 = 組数 ÷ 営業日数。平均滞在・稼働率は即会計テーブルを除外。
        </p>
      </Card>

      <Card
        title="卓別タイムライン(1営業日)"
        dense
        actions={
          <Field label="日付" htmlFor="timeline-date" className="flex items-center gap-2 [&>label]:mb-0">
            <Input id="timeline-date" size="sm" type="date" className="w-40" value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)} />
          </Field>
        }
      >
        <ChartState query={timelineQ} height={200} isEmpty={(d) => !(d?.intervals || []).length} emptyTitle="この営業日に会計データがありません">
          {gantt && (
            <div className="space-y-1 min-w-[560px] overflow-x-auto">
              <div className="flex">
                <div className="w-28 shrink-0" />
                <div className="flex-1 relative h-5">
                  {gantt.hours.map((h) => (
                    <span key={h} className="absolute -translate-x-1/2 text-2xs text-muted tabular-nums whitespace-nowrap" style={{ left: `${pos(h)}%` }}>
                      {hourLabel(h)}
                    </span>
                  ))}
                </div>
              </div>
              {gantt.tables.map((t) => (
                <div key={t.table_id} className="flex items-center">
                  <div className="w-28 shrink-0 pr-2 text-xs text-heading truncate text-right">{t.table_name}</div>
                  <div className="flex-1 relative h-7 rounded bg-surface-sunken overflow-hidden">
                    {gantt.hours.map((h) => (h > gantt.minH && h < gantt.maxH
                      ? <span key={h} className="absolute top-0 bottom-0 w-px bg-line" style={{ left: `${pos(h)}%` }} />
                      : null))}
                    {t.bars.map((iv) => (
                      <span
                        key={iv.order_id}
                        className="absolute top-1 bottom-1 rounded bg-primary-500/85 hover:bg-primary-600 cursor-default"
                        style={{
                          left: `${pos(iv.opened_hour32)}%`,
                          width: `${Math.max(((iv.closed_hour32 - iv.opened_hour32) / gantt.span) * 100, 0.6)}%`,
                        }}
                        title={`${t.table_name} / ${yen(iv.guest_count)}人 / ¥${yen(iv.total_amount)} (${hm(iv.opened_hour32)}〜${hm(iv.closed_hour32)})`}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ChartState>
        <p className="mt-2 text-2xs text-muted">
          横棒 = 入店(opened_at)〜会計(closed_at)。paid の会計のみ・即会計テーブルは除外。バーにカーソルを乗せると人数・金額を表示。
        </p>
      </Card>
    </div>
  );
}
