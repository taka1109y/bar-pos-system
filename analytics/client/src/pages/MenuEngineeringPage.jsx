import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Toolbar, Card, Alert, DataTable, Badge } from '../components/ui';
import PeriodBar from '../components/period/PeriodBar';
import DataBanner from '../components/DataBanner';
import EChart from '../components/charts/EChart';
import ChartState from '../components/charts/ChartState';
import ExportCsvButton from '../components/ExportCsvButton';
import { usePeriod } from '../utils/period';
import { yen, num } from '../utils/format';
import { api } from '../api';
import { PALETTE, baseGrid, yenAxis } from '../components/charts/chartTheme';

// メニュー分析(4象限・メニューエンジニアリング)。x=数量構成比(人気)、y=1杯粗利(利益)の散布図に
// 平均線2本(markLine)を引き、star/plowhorse/puzzle/dog の4象限で商品を色分けする。
// しきい値は両軸とも「期間内に売れた商品の単純平均」(サーバ算出)。

const CLS = {
  star:      { label: 'スター',     hint: '人気↑ 利益↑', color: PALETTE.emerald, tone: 'success', advice: '看板商品。目立つ位置で推し続ける' },
  plowhorse: { label: '主力(薄利)', hint: '人気↑ 利益↓', color: PALETTE.blue,    tone: 'info',    advice: '売れるが儲けが薄い。原価・価格の見直し余地' },
  puzzle:    { label: '隠れた逸品', hint: '人気↓ 利益↑', color: PALETTE.amber,   tone: 'warning', advice: '儲かるのに売れていない。おすすめ・訴求を強化' },
  dog:       { label: '見直し候補', hint: '人気↓ 利益↓', color: PALETTE.muted,   tone: 'neutral', advice: '入替え・レシピ改良の検討対象' },
};
const CLS_ORDER = ['star', 'plowhorse', 'puzzle', 'dog'];

const QUADRANT_COLUMNS = [
  {
    key: 'name', header: '商品名',
    render: (r) => (
      <span className="inline-flex items-center gap-1.5">
        <span className="text-heading font-medium">{r.name}</span>
        {!r.has_cost && <Badge tone="warning" size="sm">原価未設定</Badge>}
      </span>
    ),
  },
  { key: 'category', header: 'カテゴリ', render: (r) => <span className="text-muted">{r.category || '—'}</span> },
  { key: 'quantity', header: '数量', align: 'right', width: 64, render: (r) => <span className="tabular-nums">{yen(r.quantity)}</span> },
  { key: 'qty_share_pct', header: '構成比', align: 'right', width: 72, render: (r) => <span className="tabular-nums">{num(r.qty_share_pct, 1)}%</span> },
  { key: 'avg_unit_price', header: '平均単価', align: 'right', width: 90, render: (r) => <span className="tabular-nums">¥{yen(r.avg_unit_price)}</span> },
  { key: 'unit_gross_profit', header: '1杯粗利', align: 'right', width: 90, render: (r) => <span className="tabular-nums">¥{yen(r.unit_gross_profit)}</span> },
];

export default function MenuEngineeringPage() {
  const { period, isValid } = usePeriod();
  const { start, end, day_mode } = period;
  const common = { start, end, day_mode };

  const engQ = useQuery({
    queryKey: ['v1', 'products', 'engineering', start, end, day_mode],
    queryFn: () => api.getProductsEngineering(common),
    enabled: isValid,
  });

  const items = engQ.data?.items || [];
  const th = engQ.data?.thresholds;
  const noCostCount = items.filter((i) => !i.has_cost).length;

  const option = useMemo(() => {
    if (!th) return {};
    const avgX = Number(th.avg_qty_share_pct) || 0;
    const avgY = Math.round(Number(th.avg_unit_gross_profit) || 0);
    return {
      animation: false,
      grid: { ...baseGrid, bottom: 44 },
      tooltip: {
        trigger: 'item',
        formatter: (p) => {
          const r = items[p.dataIndex] || {};
          const c = CLS[r.cls] || {};
          return [
            `<div style="font-weight:600">${r.name ?? ''}</div>`,
            `${c.label ?? ''}(${c.hint ?? ''})`,
            `数量構成比 ${num(r.qty_share_pct, 1)}% (${yen(r.quantity)} 点)`,
            `1杯粗利 ¥${yen(r.unit_gross_profit)} / 平均単価 ¥${yen(r.avg_unit_price)}`,
          ].join('<br/>');
        },
      },
      xAxis: {
        type: 'value',
        name: '数量構成比(人気)',
        nameLocation: 'middle',
        nameGap: 28,
        nameTextStyle: { color: PALETTE.axis, fontSize: 11 },
        axisLabel: { color: PALETTE.axis, formatter: (v) => `${v}%` },
        splitLine: { lineStyle: { color: PALETTE.grid } },
      },
      yAxis: yenAxis({ name: '1杯粗利(利益)', nameTextStyle: { color: PALETTE.axis, fontSize: 11 } }),
      series: [{
        type: 'scatter',
        symbolSize: 11,
        data: items.map((r) => ({
          name: r.name,
          value: [Number(r.qty_share_pct) || 0, Math.round(Number(r.unit_gross_profit) || 0)],
          itemStyle: { color: (CLS[r.cls] || CLS.dog).color },
        })),
        emphasis: { itemStyle: { shadowBlur: 6, shadowColor: 'rgba(15,23,42,0.3)' } },
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { type: 'dashed', color: PALETTE.muted },
          label: {
            color: PALETTE.axis,
            fontSize: 10,
            formatter: (p) => (p.data && p.data.xAxis != null ? `平均 ${num(avgX, 1)}%` : `平均 ¥${yen(avgY)}`),
          },
          data: [{ xAxis: avgX }, { yAxis: avgY }],
        },
      }],
    };
  }, [items, th]);

  return (
    <div className="space-y-5">
      <Toolbar title="メニュー分析(4象限)" subtitle={`人気(数量構成比)×利益(1杯粗利)のメニューエンジニアリング(${day_mode === 'business' ? '営業日' : '暦日'}ベース)`}>
        <ExportCsvButton report="engineering" params={common} />
      </Toolbar>
      <DataBanner />
      <Card dense>
        <PeriodBar />
      </Card>

      {!isValid && <Alert tone="warning">期間の指定が不正です。開始は終了以前の日付にしてください。</Alert>}

      {!engQ.isLoading && noCostCount > 0 && (
        <Alert tone="warning" title={`原価未設定の商品が ${noCostCount} 品あります`}>
          原価0(粗利100%)として扱われるため、1杯粗利が実態より大きく表示されます。
          正しく分類するには POS 管理のレシピ登録で原価を設定してください(該当商品は表内に「原価未設定」バッジ)。
        </Alert>
      )}

      <Card title="4象限マップ" dense>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-2">
          {CLS_ORDER.map((k) => (
            <span key={k} className="inline-flex items-center gap-1.5 text-xs text-body">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: CLS[k].color }} aria-hidden="true" />
              {CLS[k].label}<span className="text-muted">({CLS[k].hint})</span>
            </span>
          ))}
        </div>
        <ChartState query={engQ} height={380} isEmpty={(d) => !(d?.items || []).length} emptyTitle="期間内に販売された商品がありません">
          <EChart option={option} height={380} />
        </ChartState>
        <p className="mt-2 text-2xs text-muted">
          破線=平均線{th ? `(数量構成比 ${num(th.avg_qty_share_pct, 1)}% / 1杯粗利 ¥${yen(th.avg_unit_gross_profit)})` : ''}。
          両軸とも「平均以上=↑」で4象限に分類。対象は期間内に1個以上売れた商品のみ。
        </p>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {CLS_ORDER.map((k) => {
          const c = CLS[k];
          const rows = items.filter((i) => i.cls === k);
          return (
            <Card
              key={k}
              title={`${c.label}(${c.hint})`}
              padded={false}
              actions={<Badge tone={c.tone}>{yen(rows.length)} 品</Badge>}
            >
              <p className="px-3 pt-2 text-2xs text-muted">{c.advice}</p>
              <DataTable
                columns={QUADRANT_COLUMNS}
                rows={rows}
                rowKey={(r) => r.menu_item_id}
                empty={<div className="py-6 text-center text-sm text-muted">該当する商品はありません</div>}
                className="border-0 rounded-none mt-1"
              />
            </Card>
          );
        })}
      </div>
    </div>
  );
}
