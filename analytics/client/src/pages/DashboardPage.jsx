import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Toolbar, Card, StatTile, Alert, EmptyState } from '../components/ui';
import PeriodBar from '../components/period/PeriodBar';
import DataBanner from '../components/DataBanner';
import EChart from '../components/charts/EChart';
import { usePeriod } from '../utils/period';
import { yen, num } from '../utils/format';
import { shortDate } from '../utils/datetime';
import { api } from '../api';

// Phase 0 ダッシュボード。データ源は legacy(本番 reports をそのまま流用)のため、
// 集計は「暦日・JST」固定。営業日モードが選ばれていてもこの画面は暦日で表示する(注記を出す)。
// Phase 1 以降で /api/v1 の営業日ベース集計へ差し替える。

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

  const analyticsQ = useQuery({
    queryKey: ['legacy', 'analytics', start, end],
    queryFn: () => api.getLegacyAnalytics(start, end),
    enabled: isValid,
  });
  const profitQ = useQuery({
    queryKey: ['legacy', 'profit-summary', start, end],
    queryFn: () => api.getLegacyProfitSummary(start, end),
    enabled: isValid,
  });

  const s = analyticsQ.data?.summary;
  const cmp = analyticsQ.data?.comparison;

  // 比較セレクトに応じた増減(legacy が持つのは 前期間/前週 のみ)
  const cmpInfo = useMemo(() => {
    if (!cmp) return null;
    if (compare === 'prev_period') return { rev: deltaOf(cmp.prev_period?.revenue_change_pct, '前期間'), gp: deltaOf(cmp.prev_period?.profit_change_pct, '前期間') };
    if (compare === 'prev_week')   return { rev: deltaOf(cmp.prev_week?.revenue_change_pct, '前週'),   gp: deltaOf(cmp.prev_week?.profit_change_pct, '前週') };
    if (compare) return { unsupported: true };
    return null;
  }, [cmp, compare]);

  const chartOption = useMemo(() => {
    const rows = profitQ.data?.rows || [];
    const dates = rows.map((r) => r.date);
    return {
      animation: false,
      grid: { left: 56, right: 16, top: 24, bottom: 32 },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params) => {
          const p = params[0];
          const r = rows[p.dataIndex] || {};
          return [
            `<div style="font-weight:600">${p.axisValue}</div>`,
            `売上 ¥${yen(r.revenue)}`,
            `粗利 ¥${yen(r.gross_profit)}(${num(r.gross_profit_rate, 1)}%)`,
          ].join('<br/>');
        },
      },
      xAxis: {
        type: 'category',
        data: dates,
        axisLabel: { color: '#64748b', formatter: (v) => shortDate(v) },
        axisTick: { alignWithLabel: true },
        axisLine: { lineStyle: { color: '#e2e8f0' } },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: '#64748b', formatter: (v) => (v >= 10000 ? `${v / 10000}万` : yen(v)) },
        splitLine: { lineStyle: { color: '#e2e8f0' } },
      },
      series: [{
        name: '売上',
        type: 'bar',
        data: rows.map((r) => Math.round(r.revenue || 0)),
        itemStyle: { color: '#2b70ef', borderRadius: [3, 3, 0, 0] },
        barMaxWidth: 28,
      }],
    };
  }, [profitQ.data]);

  const coverage = s?.cost_coverage_pct;
  const coverageLow = coverage != null && coverage < 100;

  return (
    <div className="space-y-5">
      <Toolbar title="ダッシュボード" subtitle="売上・粗利の概況(Phase 0: 本番 reports の暦日集計を表示)" />
      <DataBanner />
      <Card dense>
        <PeriodBar />
      </Card>

      {day_mode === 'business' && (
        <Alert tone="info" title="営業日モードは未対応(Phase 0)">
          この画面のデータは暦日(0:00 区切り・JST)で集計しています。営業日境界での集計は Phase 1 で対応します。
        </Alert>
      )}
      {cmpInfo?.unsupported && (
        <Alert tone="info">前年同日・前年同曜日の比較は Phase 0 では未対応です(前期間・前週のみ表示できます)。</Alert>
      )}
      {!isValid && <Alert tone="warning">期間の指定が不正です。開始は終了以前の日付にしてください。</Alert>}
      {analyticsQ.isError && <Alert tone="danger" title="集計を取得できません">{analyticsQ.error?.message}</Alert>}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatTile label="売上" value={s ? `¥${yen(s.total_revenue)}` : '—'}
          delta={cmpInfo?.rev?.delta} deltaTone={cmpInfo?.rev?.tone} />
        <StatTile label="粗利" value={s ? `¥${yen(s.gross_profit)}` : '—'}
          delta={cmpInfo?.gp?.delta} deltaTone={cmpInfo?.gp?.tone}
          sub={coverageLow ? `原価設定済み ${num(coverage, 1)}%` : undefined} />
        <StatTile label="粗利率" value={s ? `${num(s.gross_profit_rate, 1)}%` : '—'}
          sub={s ? `原価 ¥${yen(s.total_cost)}` : undefined} />
        <StatTile label="会計件数" value={s ? `${yen(s.order_count)} 件` : '—'}
          sub={s ? `会計単価 ¥${yen(s.avg_order_value)}` : undefined} />
        <StatTile label="客数" value={s ? `${yen(s.guest_count)} 人` : '—'}
          sub={s ? `平均 ${num(s.avg_guests_per_order, 1)} 人/会計` : undefined} />
        <StatTile label="客単価" value={s ? `¥${yen(s.avg_per_guest)}` : '—'}
          sub={s ? `平均滞在 ${yen(s.avg_stay_minutes)} 分` : undefined} />
      </div>

      {coverageLow && (
        <Alert tone="warning" title="粗利が実態より高く出ている可能性があります">
          レシピ(原価)未登録の商品は原価0として集計されます。原価設定済み商品の売上構成比は {num(coverage, 1)}% です。
        </Alert>
      )}

      <Card title="日次売上" dense>
        {profitQ.isError ? (
          <Alert tone="danger">{profitQ.error?.message}</Alert>
        ) : profitQ.isLoading ? (
          <div className="h-[280px] flex items-center justify-center text-sm text-muted" role="status" aria-busy="true">読み込み中…</div>
        ) : (profitQ.data?.rows || []).length === 0 ? (
          <EmptyState title="期間内に会計データがありません" description="期間を変更するか、データの取込状況を確認してください。" />
        ) : (
          <EChart option={chartOption} height={280} />
        )}
        <p className="mt-2 text-2xs text-muted">暦日(JST)・会計日基準。取消し(void/black_cancelled)は除外。</p>
      </Card>
    </div>
  );
}
