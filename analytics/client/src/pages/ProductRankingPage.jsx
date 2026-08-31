import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Toolbar, Card, Alert, DataTable, Badge, Field, Segmented, StatTile } from '../components/ui';
import PeriodBar from '../components/period/PeriodBar';
import DataBanner from '../components/DataBanner';
import EChart from '../components/charts/EChart';
import ChartState from '../components/charts/ChartState';
import ExportCsvButton from '../components/ExportCsvButton';
import { usePeriod } from '../utils/period';
import { yen, num } from '../utils/format';
import { api } from '../api';
import { PALETTE, baseGrid, catAxis, yenAxis, pctAxis, legend } from '../components/charts/chartTheme';

// 商品ランキング & ABC 分析。basis(売上/数量/粗利)を切り替え、パレート図(棒=値・線=累積構成比)に
// A/B/C 帯(しきい値は store_settings の abc_a_pct/abc_b_pct)を色分け表示する。
// 集計は order_items(明細)ベースで、チャージ・深夜料金を含まない。
// CSV は /api/v1/export/csv?report=ranking / report=abc。

const BASIS_OPTIONS = [
  { value: 'revenue',      label: '売上' },
  { value: 'quantity',     label: '数量' },
  { value: 'gross_profit', label: '粗利' },
];
const UNSOLD_OPTIONS = [
  { value: 'sold', label: '販売済みのみ' },
  { value: 'all',  label: '未販売も含む' },
];
const RANK_TONE = { A: 'info', B: 'warning', C: 'neutral' };
// パレート帯(markArea)の色。ランク Badge の色相(A=blue / B=amber / C=slate)と揃えた半透明
const RANK_AREA = {
  A: 'rgba(43, 112, 239, 0.07)',
  B: 'rgba(180, 83, 9, 0.08)',
  C: 'rgba(100, 116, 139, 0.08)',
};

const numCell = (v, fmt = (x) => `¥${yen(x)}`) => <span className="tabular-nums">{fmt(v)}</span>;

const COLUMNS = [
  {
    key: 'abc_rank', header: 'ランク', width: 64, align: 'center',
    render: (r) => <Badge tone={RANK_TONE[r.abc_rank] || 'neutral'}>{r.abc_rank || '—'}</Badge>,
  },
  {
    key: 'name', header: '商品名',
    render: (r) => (
      <span className="inline-flex items-center gap-1.5">
        <span className="text-heading font-medium">{r.name}</span>
        {r.is_staff_only && <Badge tone="neutral" size="sm">裏</Badge>}
        {r.is_active === false && <Badge tone="neutral" size="sm">停止中</Badge>}
      </span>
    ),
  },
  {
    key: 'category', header: 'カテゴリ',
    render: (r) => <span>{r.category || '—'}{r.subcategory && <span className="text-muted"> / {r.subcategory}</span>}</span>,
  },
  { key: 'quantity',       header: '数量',      align: 'right', width: 70, render: (r) => numCell(r.quantity, (v) => yen(v)) },
  { key: 'revenue',        header: '売上',      align: 'right', render: (r) => numCell(r.revenue) },
  { key: 'share_pct',      header: '構成比',    align: 'right', width: 72, render: (r) => numCell(r.share_pct, (v) => `${num(v, 1)}%`) },
  { key: 'cum_share_pct',  header: '累積',      align: 'right', width: 72, render: (r) => numCell(r.cum_share_pct, (v) => `${num(v, 1)}%`) },
  { key: 'avg_unit_price', header: '平均単価',  align: 'right', render: (r) => numCell(r.avg_unit_price) },
  { key: 'gross_profit',   header: '粗利',      align: 'right', render: (r) => numCell(r.gross_profit) },
  {
    key: 'cost_rate', header: '原価率', align: 'right', width: 90,
    render: (r) => (Number(r.cost_per_unit) > 0
      ? numCell(r.cost_rate, (v) => `${num(v, 1)}%`)
      : <Badge tone="warning" size="sm">原価未設定</Badge>),
  },
  {
    key: 'last_sold_at', header: '最終販売日', align: 'right', width: 100,
    render: (r) => <span className="tabular-nums text-muted">{r.last_sold_at || '—'}</span>,
  },
];

export default function ProductRankingPage() {
  const { period, isValid } = usePeriod();
  const { start, end, day_mode } = period;
  const [basis, setBasis] = useState('revenue');
  const [includeUnsold, setIncludeUnsold] = useState(false);

  const common = { start, end, day_mode };
  const rankParams = { ...common, basis, ...(includeUnsold ? { include_unsold: true } : {}) };
  const abcParams = { ...common, basis };

  const rankQ = useQuery({
    queryKey: ['v1', 'products', 'ranking', start, end, day_mode, basis, includeUnsold],
    queryFn: () => api.getProductsRanking(rankParams),
    enabled: isValid,
  });
  const abcQ = useQuery({
    queryKey: ['v1', 'products', 'abc', start, end, day_mode, basis],
    queryFn: () => api.getProductsAbc(abcParams),
    enabled: isValid,
  });

  const basisLabel = BASIS_OPTIONS.find((b) => b.value === basis)?.label || '売上';
  const fmtBasisValue = (v) => (basis === 'quantity' ? `${yen(v)} 点` : `¥${yen(v)}`);

  const items = rankQ.data?.items || [];
  const thresholds = rankQ.data?.thresholds;

  // パレート図は販売済み商品のみ(未販売は値0で図の情報にならない)。basis の値で降順
  const chartItems = useMemo(() => {
    const val = (r) => Number(basis === 'quantity' ? r.quantity : basis === 'gross_profit' ? r.gross_profit : r.revenue) || 0;
    return items.filter((r) => Number(r.quantity) > 0).slice().sort((a, b) => val(b) - val(a));
  }, [items, basis]);

  const option = useMemo(() => {
    const val = (r) => Math.round(Number(basis === 'quantity' ? r.quantity : basis === 'gross_profit' ? r.gross_profit : r.revenue) || 0);
    const fmtBasis = (v) => (basis === 'quantity' ? `${yen(v)} 点` : `¥${yen(v)}`);
    // A/B/C 帯(markArea)。chartItems は basis 降順なので各ランクは連続区間になる
    const areas = [];
    let startIdx = 0;
    for (const rank of ['A', 'B', 'C']) {
      let endIdx = -1;
      chartItems.forEach((r, i) => { if (r.abc_rank === rank) endIdx = i; });
      if (endIdx >= startIdx) {
        areas.push([
          { name: rank, xAxis: startIdx, itemStyle: { color: RANK_AREA[rank] } },
          { xAxis: endIdx },
        ]);
        startIdx = endIdx + 1;
      }
    }
    const many = chartItems.length > 30;
    return {
      animation: false,
      grid: { ...baseGrid, right: 48, bottom: many ? 96 : 76 },
      legend: legend(),
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (ps) => {
          const i = ps?.[0]?.dataIndex ?? 0;
          const r = chartItems[i] || {};
          return [
            `<div style="font-weight:600">${r.name ?? ''}</div>`,
            `${basisLabel} ${fmtBasis(val(r))} (構成比 ${num(r.share_pct, 1)}%)`,
            `累積 ${num(r.cum_share_pct, 1)}% / ランク ${r.abc_rank ?? '—'}`,
          ].join('<br/>');
        },
      },
      xAxis: catAxis(chartItems.map((r) => r.name), {
        axisLabel: {
          rotate: 40, fontSize: 10, interval: many ? 'auto' : 0,
          formatter: (v) => (String(v).length > 8 ? `${String(v).slice(0, 7)}…` : v),
        },
      }),
      yAxis: [
        basis === 'quantity'
          ? { type: 'value', axisLabel: { color: PALETTE.axis }, splitLine: { lineStyle: { color: PALETTE.grid } } }
          : yenAxis(),
        pctAxis({ max: 100 }),
      ],
      ...(many ? { dataZoom: [{ type: 'slider', height: 16, bottom: 6 }] } : {}),
      series: [
        {
          name: basisLabel, type: 'bar',
          data: chartItems.map(val),
          itemStyle: { color: PALETTE.blue, borderRadius: [3, 3, 0, 0] },
          barMaxWidth: 24,
          markArea: { silent: true, label: { position: 'insideTop', color: PALETTE.axis, fontSize: 10 }, data: areas },
        },
        {
          name: '累積構成比', type: 'line', yAxisIndex: 1,
          data: chartItems.map((r) => (r.cum_share_pct == null ? null : Math.round(Number(r.cum_share_pct) * 10) / 10)),
          itemStyle: { color: PALETTE.emerald },
          lineStyle: { color: PALETTE.emerald, width: 2 },
          symbolSize: 4,
        },
      ],
    };
  }, [chartItems, basis, basisLabel]);

  const abcClasses = abcQ.data?.classes || [];
  const clsOf = (rank) => abcClasses.find((c) => c.rank === rank);

  return (
    <div className="space-y-5">
      <Toolbar title="ランキング & ABC" subtitle={`商品別の売れ筋ランキングとABC分析(${day_mode === 'business' ? '営業日' : '暦日'}ベース)`}>
        <ExportCsvButton report="ranking" params={rankParams}>ランキングCSV</ExportCsvButton>
        <ExportCsvButton report="abc" params={abcParams}>ABC CSV</ExportCsvButton>
      </Toolbar>
      <DataBanner />
      <Card dense>
        <PeriodBar />
      </Card>

      {!isValid && <Alert tone="warning">期間の指定が不正です。開始は終了以前の日付にしてください。</Alert>}

      <Card dense>
        <div className="flex flex-wrap items-end gap-4">
          <Field label="集計基準">
            <Segmented options={BASIS_OPTIONS} value={basis} onChange={setBasis} />
          </Field>
          <Field label="未販売商品">
            <Segmented options={UNSOLD_OPTIONS} value={includeUnsold ? 'all' : 'sold'} onChange={(v) => setIncludeUnsold(v === 'all')} />
          </Field>
        </div>
      </Card>

      {abcQ.isError && <Alert tone="danger" title="ABC集計を取得できません">{abcQ.error?.message}</Alert>}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {['A', 'B', 'C'].map((rank) => {
          const c = clsOf(rank);
          return (
            <StatTile
              key={rank}
              dense
              label={`${rank} ランク`}
              value={c ? `${yen(c.item_count)} 品` : '—'}
              sub={c ? `${basisLabel} ${fmtBasisValue(c.value)} (構成比 ${num(c.share_pct, 1)}%)` : undefined}
            />
          );
        })}
      </div>

      <Card title={`パレート図(${basisLabel})`} dense>
        <ChartState query={rankQ} height={360} isEmpty={() => chartItems.length === 0} emptyTitle="期間内に販売された商品がありません">
          <EChart option={option} height={360} />
        </ChartState>
        <p className="mt-2 text-2xs text-muted">
          棒={basisLabel}、線=累積構成比。背景の帯は A/B/C ランク
          {thresholds ? `(A: 累積 ${num(thresholds.a_pct, 0)}%以下 / B: ${num(thresholds.b_pct, 0)}%以下 / C: それ以外)` : ''}。
          集計は明細ベースでチャージ・深夜料金を含みません。
        </p>
      </Card>

      <Card title="商品別明細" padded={false}>
        <ChartState query={rankQ} height={200} isEmpty={() => items.length === 0} emptyTitle="期間内に商品データがありません">
          <DataTable columns={COLUMNS} rows={items} rowKey={(r) => r.menu_item_id} className="border-0 rounded-none" />
        </ChartState>
      </Card>
    </div>
  );
}
