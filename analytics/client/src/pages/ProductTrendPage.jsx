import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Toolbar, Card, Alert, DataTable, Badge, Field, Segmented, Input, EmptyState, Skeleton, cn } from '../components/ui';
import PeriodBar from '../components/period/PeriodBar';
import DataBanner from '../components/DataBanner';
import EChart from '../components/charts/EChart';
import ChartState from '../components/charts/ChartState';
import ExportCsvButton from '../components/ExportCsvButton';
import { usePeriod } from '../utils/period';
import { yen } from '../utils/format';
import { api } from '../api';
import { PALETTE, SERIES10, baseGrid, catAxis, yenAxis, legend } from '../components/charts/chartTheme';

// 商品推移。検索付きの複数選択(最大10商品)で商品を選び、PeriodBar の粒度(日/週/月/年度)で
// 数量/売上の折れ線を比較する。候補は ranking API(include_unsold=true)から取得。
// 系列色は SERIES10(chartTheme)を選択順に固定割り当てし、チップの色と一致させる。

const MAX_ITEMS = 10;

const METRIC_OPTIONS = [
  { value: 'quantity', label: '数量' },
  { value: 'revenue',  label: '売上' },
];

export default function ProductTrendPage() {
  const { period, isValid } = usePeriod();
  const { start, end, day_mode, granularity } = period;
  const [selected, setSelected] = useState([]); // [{ menu_item_id, name }] 選択順を保持
  const [metric, setMetric] = useState('quantity');
  const [search, setSearch] = useState('');

  const common = { start, end, day_mode };
  const ids = selected.map((s) => s.menu_item_id);

  // 商品候補(未販売・停止中も含む全商品)。basis は候補の並び順にだけ影響する
  const candQ = useQuery({
    queryKey: ['v1', 'products', 'ranking', start, end, day_mode, 'candidates'],
    queryFn: () => api.getProductsRanking({ ...common, basis: 'revenue', include_unsold: true }),
    enabled: isValid,
  });

  const trendQ = useQuery({
    queryKey: ['v1', 'products', 'trend', start, end, day_mode, granularity, ids.join(',')],
    queryFn: () => api.getProductsTrend({ ...common, granularity, menu_item_ids: ids.join(',') }),
    enabled: isValid && ids.length >= 1 && ids.length <= MAX_ITEMS,
  });

  const candidates = useMemo(() => {
    const all = candQ.data?.items || [];
    const q = search.trim().toLowerCase();
    const hit = q ? all.filter((i) => String(i.name || '').toLowerCase().includes(q)) : all;
    return hit.slice(0, 50);
  }, [candQ.data, search]);

  const toggle = (item) => {
    setSelected((prev) => {
      if (prev.some((s) => s.menu_item_id === item.menu_item_id)) {
        return prev.filter((s) => s.menu_item_id !== item.menu_item_id);
      }
      if (prev.length >= MAX_ITEMS) return prev;
      return [...prev, { menu_item_id: item.menu_item_id, name: item.name }];
    });
  };

  const metricLabel = METRIC_OPTIONS.find((m) => m.value === metric)?.label || '数量';
  const fmtMetric = (v) => (metric === 'revenue' ? `¥${yen(v)}` : `${yen(v)}`);

  const series = trendQ.data?.series || [];
  const labels = series[0]?.rows?.map((r) => r.label) || [];

  const option = useMemo(() => ({
    animation: false,
    grid: baseGrid,
    legend: legend({ type: 'scroll' }),
    tooltip: {
      trigger: 'axis',
      valueFormatter: (v) => (v == null ? '—' : (metric === 'revenue' ? `¥${yen(v)}` : `${yen(v)} 点`)),
    },
    xAxis: catAxis(labels),
    yAxis: metric === 'revenue'
      ? yenAxis()
      : { type: 'value', axisLabel: { color: PALETTE.axis }, splitLine: { lineStyle: { color: PALETTE.grid } } },
    series: series.map((s, i) => ({
      name: s.name,
      type: 'line',
      data: (s.rows || []).map((r) => Math.round(Number(r[metric]) || 0)),
      itemStyle: { color: SERIES10[i % SERIES10.length] },
      lineStyle: { color: SERIES10[i % SERIES10.length], width: 2 },
      symbolSize: 5,
    })),
  }), [series, labels, metric]);

  // 表: 行=期間バケット、列=選択商品(選択メトリクスの値)
  const tableColumns = useMemo(() => [
    { key: 'label', header: '期間', width: 110, render: (r) => <span className="text-heading tabular-nums">{r.label}</span> },
    ...series.map((s, i) => ({
      key: `m${s.menu_item_id}`,
      header: s.name,
      align: 'right',
      render: (r) => <span className="tabular-nums">{fmtMetric(r.values[i]?.[metric])}</span>,
    })),
  ], [series, metric]); // eslint-disable-line react-hooks/exhaustive-deps

  const tableRows = useMemo(() => {
    if (series.length === 0) return [];
    return (series[0].rows || []).map((r0, idx) => ({
      period_start: r0.period_start,
      label: r0.label,
      values: series.map((s) => s.rows[idx]),
    }));
  }, [series]);

  return (
    <div className="space-y-5">
      <Toolbar title="商品推移" subtitle={`商品別の${metricLabel}推移比較・最大${MAX_ITEMS}商品(${day_mode === 'business' ? '営業日' : '暦日'}ベース)`}>
        {ids.length >= 1 && (
          <ExportCsvButton report="product_trend" params={{ ...common, granularity, menu_item_ids: ids.join(',') }} />
        )}
      </Toolbar>
      <DataBanner />
      <Card dense>
        <PeriodBar />
      </Card>

      {!isValid && <Alert tone="warning">期間の指定が不正です。開始は終了以前の日付にしてください。</Alert>}

      <Card title={`商品を選択(${selected.length}/${MAX_ITEMS})`} dense>
        {selected.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {selected.map((s, i) => (
              <span
                key={s.menu_item_id}
                className="inline-flex items-center gap-1.5 pl-2.5 pr-1 py-0.5 rounded-full text-xs font-medium bg-primary-50 text-primary-700"
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: SERIES10[i % SERIES10.length] }} aria-hidden="true" />
                {s.name}
                <button
                  type="button"
                  aria-label={`${s.name} を選択から外す`}
                  onClick={() => toggle(s)}
                  className="w-4 h-4 inline-flex items-center justify-center rounded-full hover:bg-primary-100 cursor-pointer"
                >
                  <svg viewBox="0 0 20 20" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M6 6l8 8M14 6l-8 8" strokeLinecap="round" />
                  </svg>
                </button>
              </span>
            ))}
          </div>
        )}
        <Field label="商品検索" htmlFor="product-search" className="max-w-sm">
          <Input id="product-search" type="search" placeholder="商品名で絞り込み" value={search} onChange={(e) => setSearch(e.target.value)} />
        </Field>
        {candQ.isError && <Alert tone="danger" className="mt-2" title="商品一覧を取得できません">{candQ.error?.message}</Alert>}
        {candQ.isLoading ? (
          <Skeleton height={120} className="mt-2" />
        ) : (
          <div className="mt-2 max-h-56 overflow-y-auto border border-line rounded-lg divide-y divide-line">
            {candidates.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted">該当する商品がありません</div>
            ) : candidates.map((c) => {
              const active = ids.includes(c.menu_item_id);
              const full = !active && selected.length >= MAX_ITEMS;
              return (
                <button
                  key={c.menu_item_id}
                  type="button"
                  aria-pressed={active}
                  disabled={full}
                  onClick={() => toggle(c)}
                  className={cn(
                    'w-full flex items-center justify-between gap-2 px-3 py-1.5 text-sm text-left transition-colors cursor-pointer',
                    active ? 'bg-primary-50 text-primary-700' : 'text-body hover:bg-surface-hover',
                    full && 'opacity-40 cursor-not-allowed'
                  )}
                >
                  <span className="inline-flex items-center gap-1.5 min-w-0">
                    <span className="truncate">{c.name}</span>
                    {c.is_staff_only && <Badge tone="neutral" size="sm">裏</Badge>}
                    {c.is_active === false && <Badge tone="neutral" size="sm">停止中</Badge>}
                  </span>
                  <span className="text-xs text-muted shrink-0">
                    {c.category || '—'}{Number(c.quantity) > 0 ? ` ・ ${yen(c.quantity)} 点` : ' ・ 期間内未販売'}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {selected.length >= MAX_ITEMS && (
          <p className="mt-2 text-2xs text-muted">選択は最大 {MAX_ITEMS} 商品までです。追加するには先にどれかを外してください。</p>
        )}
      </Card>

      <Card
        title={`商品別${metricLabel}推移`}
        dense
        actions={<Segmented size="sm" options={METRIC_OPTIONS} value={metric} onChange={setMetric} />}
      >
        {ids.length === 0 ? (
          <EmptyState title="商品を選択してください" description={`上の一覧から比較したい商品(最大${MAX_ITEMS}件)を選ぶと推移が表示されます。`} />
        ) : (
          <ChartState query={trendQ} height={320} isEmpty={(d) => !(d?.series || []).length} emptyTitle="期間内に販売データがありません">
            <EChart option={option} height={320} />
          </ChartState>
        )}
        <p className="mt-2 text-2xs text-muted">
          期間内の全バケットを0埋めで表示。売上は明細(単価×数量)ベースでチャージ・深夜料金を含みません。
        </p>
      </Card>

      {ids.length > 0 && (
        <Card title="明細" padded={false}>
          <ChartState query={trendQ} height={200} isEmpty={(d) => !(d?.series || []).length} emptyTitle="期間内に販売データがありません">
            <DataTable
              columns={tableColumns}
              rows={tableRows}
              rowKey={(r, i) => r.period_start || i}
              className="border-0 rounded-none"
            />
          </ChartState>
        </Card>
      )}
    </div>
  );
}
