import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Toolbar, Card, Alert, DataTable, StatTile, cn } from '../components/ui';
import PeriodBar from '../components/period/PeriodBar';
import DataBanner from '../components/DataBanner';
import EChart from '../components/charts/EChart';
import ChartState from '../components/charts/ChartState';
import ExportCsvButton from '../components/ExportCsvButton';
import PrintButton from '../components/PrintButton';
import { usePeriod } from '../utils/period';
import { yen, num } from '../utils/format';
import { api } from '../api';
import { PALETTE, baseGrid, catAxis, yenAxis, legend } from '../components/charts/chartTheme';

// 価格効果(/pricing/effect)。GET /api/v1/pricing/effect?start&end&day_mode。
//
// サーバ側の定義(routes/pricing.js)をそのまま画面の注記に反映している:
//   ・バンド = 明細ごとの「約定単価 ÷ 定価 − 1」を5%刻みで集計したもの。
//     定価は約定時スナップ(order_items.base_price_at_order)優先、無ければ現行 menu_items.base_price
//   ・定価が 0/NULL の明細(時価商品など)は比率を出せないのでバンドから除外し、件数だけ summary に出す
//   ・値引き費用(暴落原資)と純差分は本番 /api/reports/discount-cost と同一定義
//     (verify の legacy_match_discount_cost が day_mode=calendar での一致を保証している)
//   ・avg_ratio_pct は金額加重(Σ約定額 ÷ Σ定価額 − 1)。安い1杯と高額1杯を同じ重みにしない
// CSV は /api/v1/export/csv?report=pricing_bands。

const fmtYen = (v) => `¥${yen(v)}`;
const fmtPct = (v) => (v == null ? '—' : `${num(v, 1)}%`);
// 定価比の符号付き表示(+3.2% / -1.0% / 0.0%)
const fmtSignedPct = (v) => {
  if (v == null) return '—';
  const n = Number(v);
  return `${n > 0 ? '+' : ''}${num(n, 1)}%`;
};

// バンドの色: 定価より安い = 赤(値引き)、定価ちょうどを含む 0%〜+5% = 青、定価より高い = 緑。
// 色だけに頼らないよう、下の表と注記でも「値引き / 定価 / 値上がり」を文字で示す。
const BAND_RED = '#dc2626'; // red-600(chartTheme SERIES10 と同じ値)
function bandColor(minPct) {
  if (minPct < 0) return BAND_RED;
  if (minPct === 0) return PALETTE.blue;
  return PALETTE.emerald;
}
function bandKind(minPct) {
  if (minPct < 0) return '値引き';
  if (minPct === 0) return '定価付近';
  return '値上がり';
}

export default function PricingEffectPage() {
  const { period, isValid } = usePeriod();
  const { start, end, day_mode } = period;
  const params = { start, end, day_mode };

  const effectQ = useQuery({
    queryKey: ['v1', 'pricing', 'effect', start, end, day_mode],
    queryFn: () => api.getPricingEffect(params),
    enabled: isValid,
  });

  const bands = effectQ.data?.bands || [];
  const summary = effectQ.data?.summary || null;
  const discount = effectQ.data?.discount || null;
  const byDay = discount?.by_day || [];

  // 値引き / 定価付近 / 値上がり の3区分に畳んだ数量(KPI とバンド表の注記に使う)
  const kinds = useMemo(() => {
    const acc = { 値引き: 0, 定価付近: 0, 値上がり: 0 };
    for (const b of bands) acc[bandKind(b.band_min_pct)] += b.quantity;
    return acc;
  }, [bands]);

  // バンド別ヒストグラム: 棒 = 数量(左軸)、線 = 売上(右軸)
  const bandOption = useMemo(() => ({
    animation: false,
    grid: { ...baseGrid, right: 56, bottom: 56 },
    legend: legend(),
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (ps) => {
        const i = ps?.[0]?.dataIndex ?? 0;
        const b = bands[i] || {};
        return [
          `<div style="font-weight:600">${b.band_label ?? ''}（${bandKind(b.band_min_pct)}）</div>`,
          `数量 ${yen(b.quantity)} 点（構成比 ${num(b.share_pct, 1)}%）`,
          `売上 ¥${yen(b.revenue)}（構成比 ${num(b.revenue_share_pct, 1)}%）`,
        ].join('<br/>');
      },
    },
    xAxis: catAxis(bands.map((b) => b.band_label), {
      axisLabel: { rotate: 45, fontSize: 10, color: PALETTE.axis },
    }),
    yAxis: [
      { type: 'value', axisLabel: { color: PALETTE.axis, formatter: (v) => `${v}点` }, splitLine: { lineStyle: { color: PALETTE.grid } } },
      yenAxis({ splitLine: { show: false } }),
    ],
    series: [
      {
        name: '数量', type: 'bar',
        data: bands.map((b) => ({ value: b.quantity, itemStyle: { color: bandColor(b.band_min_pct), borderRadius: [3, 3, 0, 0] } })),
        barMaxWidth: 28,
      },
      {
        name: '売上', type: 'line', yAxisIndex: 1,
        data: bands.map((b) => Math.round(b.revenue || 0)),
        itemStyle: { color: PALETTE.violet },
        lineStyle: { color: PALETTE.violet, width: 2 },
        symbolSize: 5,
      },
    ],
  }), [bands]);

  // 値引き費用の日次推移(棒 = 値引き費用、線 = 純差分。純差分は負値もあり得る)
  const discountOption = useMemo(() => ({
    animation: false,
    grid: { ...baseGrid, right: 56 },
    legend: legend(),
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (ps) => {
        const i = ps?.[0]?.dataIndex ?? 0;
        const r = byDay[i] || {};
        return [
          `<div style="font-weight:600">${r.date ?? ''}</div>`,
          `値引き費用 ¥${yen(r.amount)}（${yen(r.count)} 明細）`,
          `純差分 ${r.net_diff < 0 ? '-' : '+'}¥${yen(Math.abs(r.net_diff || 0))}`,
        ].join('<br/>');
      },
    },
    xAxis: catAxis(byDay.map((r) => r.date), { axisLabel: { rotate: 45, fontSize: 10, color: PALETTE.axis } }),
    yAxis: [yenAxis(), yenAxis({ splitLine: { show: false } })],
    series: [
      {
        name: '値引き費用', type: 'bar',
        data: byDay.map((r) => Math.round(r.amount || 0)),
        itemStyle: { color: BAND_RED, borderRadius: [3, 3, 0, 0] },
        barMaxWidth: 28,
      },
      {
        name: '純差分（値上がり相殺後）', type: 'line', yAxisIndex: 1,
        data: byDay.map((r) => Math.round(r.net_diff || 0)),
        itemStyle: { color: PALETTE.emerald },
        lineStyle: { color: PALETTE.emerald, width: 2 },
        symbolSize: 5,
      },
    ],
  }), [byDay]);

  const BAND_COLUMNS = [
    {
      key: 'band_label', header: '価格帯（定価比）', width: 150,
      render: (r) => <span className={cn(r._total ? 'font-semibold text-heading' : 'text-heading')}>{r.band_label}</span>,
    },
    {
      key: 'kind', header: '区分', width: 90,
      render: (r) => <span className="text-muted">{r._total ? '' : bandKind(r.band_min_pct)}</span>,
    },
    { key: 'quantity', header: '数量', align: 'right', width: 90, render: (r) => <span className={cn('tabular-nums', r._total && 'font-semibold text-heading')}>{yen(r.quantity)} 点</span> },
    { key: 'share_pct', header: '数量構成比', align: 'right', width: 100, render: (r) => <span className={cn('tabular-nums', r._total ? 'font-semibold text-heading' : 'text-muted')}>{fmtPct(r.share_pct)}</span> },
    { key: 'revenue', header: '売上', align: 'right', width: 120, render: (r) => <span className={cn('tabular-nums', r._total && 'font-semibold text-heading')}>{fmtYen(r.revenue)}</span> },
    { key: 'revenue_share_pct', header: '売上構成比', align: 'right', width: 100, render: (r) => <span className={cn('tabular-nums', r._total ? 'font-semibold text-heading' : 'text-muted')}>{fmtPct(r.revenue_share_pct)}</span> },
  ];

  const bandTableRows = useMemo(() => {
    if (bands.length === 0 || !summary) return [];
    return [...bands, {
      _total: true,
      band_label: '合計',
      quantity: summary.quantity_total,
      share_pct: bands.length > 0 ? 100 : 0,
      revenue: summary.revenue_total,
      revenue_share_pct: bands.length > 0 ? 100 : 0,
    }];
  }, [bands, summary]);

  const excluded = summary?.excluded_lines || 0;

  return (
    <div className="space-y-5">
      <Toolbar
        title="価格効果"
        subtitle={`約定単価が定価から何%動いたか（${day_mode === 'business' ? '営業日' : '暦日'}ベース・会計日基準）`}
      >
        <ExportCsvButton report="pricing_bands" params={params} />
        <PrintButton />
      </Toolbar>
      <DataBanner />
      <Card dense>
        <PeriodBar />
      </Card>

      {!isValid && <Alert tone="warning">期間の指定が不正です。開始は終了以前の日付にしてください。</Alert>}
      {discount && discount.monthly_cap > 0 && discount.cap_usage_pct != null && discount.cap_usage_pct >= 80 && (
        <Alert tone={discount.over_cap ? 'danger' : 'warning'} title="値引き費用が月次上限に近づいています">
          {discount.month_start} 〜 {end} の累計 ¥{yen(discount.month_total)} / 上限 ¥{yen(discount.monthly_cap)}
          （{num(discount.cap_usage_pct, 1)}%）。{discount.over_cap ? '上限を超えています。' : ''}
          上限は POS のシステム設定（system_settings.monthly_discount_cap）で変更できます。
        </Alert>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatTile dense label="平均比率（定価比）" value={summary ? fmtSignedPct(summary.avg_ratio_pct) : '—'} sub="Σ約定額 ÷ Σ定価額 − 1" />
        <StatTile dense label="値引きで売れた数量" value={`${yen(kinds.値引き)} 点`} sub="定価より安く約定した明細" />
        <StatTile dense label="値上がりで売れた数量" value={`${yen(kinds.値上がり)} 点`} sub="定価より高く約定した明細" />
        <StatTile dense label="値引き費用（暴落原資）" value={discount ? fmtYen(discount.total) : '—'} sub="Σ max(0, 定価 − 約定単価) × 数量" />
        <StatTile
          dense label="純差分" value={discount ? `${discount.net_diff < 0 ? '-' : '+'}¥${yen(Math.abs(discount.net_diff))}` : '—'}
          sub="Σ(約定単価 − 定価) × 数量（値上がり相殺後）"
        />
        <StatTile
          dense label="月次上限の使用率"
          value={discount && discount.monthly_cap > 0 ? fmtPct(discount.cap_usage_pct) : '—'}
          sub={discount && discount.monthly_cap > 0
            ? `${discount.month_start} 〜 累計 ¥${yen(discount.month_total)}`
            : '上限が未設定（0＝無効）です'}
        />
      </div>

      {excluded > 0 && (
        <Alert tone="info" title="定価が 0 の明細はバンドから除外しています">
          定価（base_price）が 0 または未設定の商品（時価商品など）は定価比を計算できないため、
          バンド集計から {yen(excluded)} 明細（{yen(summary.excluded_quantity)} 点）を除外しています。
          値引き費用・純差分の集計も同じ定義（定価0の明細は差額0）です。
        </Alert>
      )}

      <Card title="定価比バンド別の販売数量と売上" dense>
        <ChartState query={effectQ} height={340} isEmpty={(d) => !(d?.bands || []).length} emptyTitle="期間内に明細がありません">
          <EChart option={bandOption} height={340} />
        </ChartState>
        <p className="mt-2 text-2xs text-muted">
          棒 = 数量（左軸）、線 = 売上（右軸）。棒の色は
          <span className="font-medium text-danger"> 赤 = 値引き（定価より安い）</span>、
          <span className="font-medium text-primary-600"> 青 = 定価付近（0%〜+5%）</span>、
          <span className="font-medium text-success"> 緑 = 値上がり</span>。
          比率は「約定単価 ÷ 定価 − 1」で、定価は約定時のスナップ（base_price_at_order）を優先します。
        </p>
      </Card>

      <Card title="バンド別の明細" padded={false}>
        <ChartState query={effectQ} height={200} isEmpty={(d) => !(d?.bands || []).length} emptyTitle="期間内に明細がありません">
          <DataTable
            columns={BAND_COLUMNS}
            rows={bandTableRows}
            rowKey={(r, i) => (r._total ? 'total' : r.band_label || i)}
            className="border-0 rounded-none"
          />
        </ChartState>
      </Card>

      <Card title="値引き費用（暴落原資）の日次推移" dense>
        <ChartState query={effectQ} height={300} isEmpty={(d) => !(d?.discount?.by_day || []).length} emptyTitle="期間内に会計がありません">
          <EChart option={discountOption} height={300} />
        </ChartState>
        <p className="mt-2 text-2xs text-muted">
          値引き費用 = Σ max(0, 定価 − 約定単価) × 数量（値下がり分のみ）。
          純差分 = Σ(約定単価 − 定価) × 数量 で、値上がり分を相殺した実質差のため負値にも正値にもなります。
          定義は POS の「値引き費用」レポートと同一です。
        </p>
      </Card>
    </div>
  );
}
