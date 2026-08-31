import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Toolbar, Card, StatTile, Alert } from '../components/ui';
import PeriodBar from '../components/period/PeriodBar';
import DataBanner from '../components/DataBanner';
import EChart from '../components/charts/EChart';
import ChartState from '../components/charts/ChartState';
import { usePeriod, COMPARE_LABELS } from '../utils/period';
import { yen, num } from '../utils/format';
import { api } from '../api';
import {
  PALETTE, PAYMENT_COLORS, PAYMENT_LABELS,
  baseGrid, catAxis, yenAxis, pctAxis, legend, buildHeatmapOption, hoursRange,
} from '../components/charts/chartTheme';

// Phase 1 ダッシュボード。/api/v1/sales/* (営業日/暦日対応の v1 集計)で表示する。
// KPI 8枚 + 日次売上×粗利率 + 支払方法ドーナツ + 曜日×時間帯ミニヒートマップ。
// 比較バッジは PeriodBar の比較選択(未選択時は前期間)の change_pct を使う。

// 増減率 → StatTile の delta 表示。null(基準0)は '—'。
function deltaOf(pct, label) {
  if (pct == null || !Number.isFinite(Number(pct))) return { delta: `— vs ${label}`, tone: 'neutral' };
  const p = Number(pct);
  const sign = p > 0 ? '+' : '';
  return { delta: `${sign}${num(p, 1)}% vs ${label}`, tone: p > 0 ? 'up' : p < 0 ? 'down' : 'neutral' };
}

export default function DashboardPage() {
  const { period, isValid } = usePeriod();
  const { start, end, day_mode, compare } = period;
  // 比較未選択時はダッシュボードの既定として前期間比を出す
  const compareKey = compare || 'prev_period';
  const compareLabel = COMPARE_LABELS[compareKey] || '前期間';
  const common = { start, end, day_mode };

  const summaryQ = useQuery({
    queryKey: ['v1', 'summary', start, end, day_mode, compareKey],
    queryFn: () => api.getSalesSummary({ ...common, compare: compareKey }),
    enabled: isValid,
  });
  const trendQ = useQuery({
    queryKey: ['v1', 'trend', start, end, day_mode, 'day', ''],
    queryFn: () => api.getSalesTrend({ ...common, granularity: 'day' }),
    enabled: isValid,
  });
  const paymentsQ = useQuery({
    queryKey: ['v1', 'payments', start, end, day_mode],
    queryFn: () => api.getSalesPayments(common),
    enabled: isValid,
  });
  const heatmapQ = useQuery({
    queryKey: ['v1', 'heatmap', start, end, day_mode, 'revenue'],
    queryFn: () => api.getSalesHeatmap({ ...common, metric: 'revenue' }),
    enabled: isValid,
  });

  const s = summaryQ.data?.summary;
  const c = summaryQ.data?.comparison?.[compareKey];
  const coverage = s?.cost_coverage_pct;
  const coverageLow = coverage != null && coverage < 100;

  // 日次売上(棒) + 粗利率(線・右軸%)
  const trendOption = useMemo(() => {
    const rows = trendQ.data?.rows || [];
    return {
      animation: false,
      grid: { ...baseGrid, right: 48 },
      legend: legend(),
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params) => {
          const i = params?.[0]?.dataIndex ?? 0;
          const r = rows[i] || {};
          return [
            `<div style="font-weight:600">${r.label ?? ''}</div>`,
            `売上 ¥${yen(r.revenue)}`,
            `粗利 ¥${yen(r.gross_profit)}(${num(r.gross_profit_rate, 1)}%)`,
            `会計 ${yen(r.order_count)} 件 / 客数 ${yen(r.guest_count)} 人`,
          ].join('<br/>');
        },
      },
      xAxis: catAxis(rows.map((r) => r.label)),
      yAxis: [yenAxis(), pctAxis()],
      series: [
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
      ],
    };
  }, [trendQ.data]);

  // 支払方法ドーナツ(色は方法ごとに固定割り当て)
  const payOption = useMemo(() => {
    const methods = paymentsQ.data?.methods || [];
    const data = methods.map((m) => ({
      name: m.label || PAYMENT_LABELS[m.method] || m.method,
      value: Math.round(m.amount || 0),
      itemStyle: { color: PAYMENT_COLORS[m.method] || PALETTE.violet },
    }));
    return {
      animation: false,
      tooltip: { trigger: 'item', formatter: (p) => `${p.name}: ¥${yen(p.value)} (${num(p.percent, 1)}%)` },
      legend: legend({ top: 'auto', bottom: 0, left: 'center' }),
      series: [{
        type: 'pie',
        radius: ['55%', '78%'],
        center: ['50%', '45%'],
        data,
        itemStyle: { borderColor: PALETTE.surface, borderWidth: 2 },
        label: { show: false },
        emphasis: { scaleSize: 4 },
      }],
    };
  }, [paymentsQ.data]);

  // 曜日×時間帯ミニヒートマップ(売上)
  const heatOption = useMemo(() => {
    const d = heatmapQ.data;
    const hours = hoursRange(day_mode, d?.meta?.boundary_hour);
    return buildHeatmapOption({ cells: d?.cells, hours, max: d?.max });
  }, [heatmapQ.data, day_mode]);

  return (
    <div className="space-y-5">
      <Toolbar
        title="ダッシュボード"
        subtitle={`経営概況(${day_mode === 'business' ? '営業日' : '暦日'}ベース・比較: ${compareLabel})`}
      />
      <DataBanner />
      <Card dense>
        <PeriodBar />
      </Card>

      {!isValid && <Alert tone="warning">期間の指定が不正です。開始は終了以前の日付にしてください。</Alert>}
      {summaryQ.isError && <Alert tone="danger" title="集計を取得できません">{summaryQ.error?.message}</Alert>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatTile label="売上" value={s ? `¥${yen(s.total_revenue)}` : '—'}
          {...(c ? { delta: deltaOf(c.revenue_change_pct, compareLabel).delta, deltaTone: deltaOf(c.revenue_change_pct, compareLabel).tone } : {})} />
        <StatTile label="粗利" value={s ? `¥${yen(s.gross_profit)}` : '—'}
          {...(c ? { delta: deltaOf(c.gross_profit_change_pct, compareLabel).delta, deltaTone: deltaOf(c.gross_profit_change_pct, compareLabel).tone } : {})}
          sub={coverageLow ? `原価設定済み ${num(coverage, 1)}%` : undefined} />
        <StatTile label="粗利率" value={s ? `${num(s.gross_profit_rate, 1)}%` : '—'}
          sub={s ? `原価 ¥${yen(s.total_cost)}` : undefined} />
        <StatTile label="客数" value={s ? `${yen(s.guest_count)} 人` : '—'}
          {...(c ? { delta: deltaOf(c.guest_count_change_pct, compareLabel).delta, deltaTone: deltaOf(c.guest_count_change_pct, compareLabel).tone } : {})}
          sub={s ? `平均 ${num(s.avg_guests_per_order, 1)} 人/会計` : undefined} />
        <StatTile label="客単価" value={s ? `¥${yen(s.avg_per_guest)}` : '—'}
          {...(c ? { delta: deltaOf(c.avg_per_guest_change_pct, compareLabel).delta, deltaTone: deltaOf(c.avg_per_guest_change_pct, compareLabel).tone } : {})}
          sub={s ? `平均滞在 ${yen(s.avg_stay_minutes)} 分` : undefined} />
        <StatTile label="会計件数" value={s ? `${yen(s.order_count)} 件` : '—'}
          {...(c ? { delta: deltaOf(c.order_count_change_pct, compareLabel).delta, deltaTone: deltaOf(c.order_count_change_pct, compareLabel).tone } : {})}
          sub={s ? `会計単価 ¥${yen(s.avg_order_value)}` : undefined} />
        <StatTile label="営業日数" value={s ? `${yen(s.open_days)} 日` : '—'}
          sub={s ? `販売点数 ${yen(s.total_item_count)} 点` : undefined} />
        <StatTile label="1営業日平均" value={s ? `¥${yen(s.revenue_per_open_day)}` : '—'}
          sub="売上 ÷ 営業日数" />
      </div>

      {coverageLow && (
        <Alert tone="warning" title="原価未設定商品あり: 粗利は実態より高く出ます">
          レシピ(原価)未登録の商品は原価0として集計されます。原価設定済み商品の売上構成比は {num(coverage, 1)}% です。
        </Alert>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <Card title="日次売上と粗利率" dense className="xl:col-span-2">
          <ChartState query={trendQ} height={300} isEmpty={(d) => !(d?.rows || []).length} emptyTitle="期間内に会計データがありません">
            <EChart option={trendOption} height={300} />
          </ChartState>
          <p className="mt-2 text-2xs text-muted">
            {day_mode === 'business' ? '営業日' : '暦日'}・会計日基準。取消し(void/black_cancelled)は除外。
          </p>
        </Card>
        <Card title="支払方法" dense>
          <ChartState query={paymentsQ} height={300} isEmpty={(d) => !(d?.methods || []).some((m) => Number(m.amount) > 0)} emptyTitle="期間内に会計データがありません">
            <EChart option={payOption} height={300} />
          </ChartState>
        </Card>
      </div>

      <Card title="曜日×時間帯(売上)" dense>
        <ChartState query={heatmapQ} height={240} isEmpty={(d) => !(d?.cells || []).length} emptyTitle="期間内に注文データがありません">
          <EChart option={heatOption} height={240} />
        </ChartState>
        <p className="mt-2 text-2xs text-muted">
          {heatmapQ.data?.meta?.note || '売上は注文明細(order_items)の注文時刻ベースで、チャージ・深夜料金を含みません。'}
        </p>
      </Card>
    </div>
  );
}
