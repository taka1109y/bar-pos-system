import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Toolbar, Card, Alert, DataTable, StatTile, Badge, cn } from '../components/ui';
import PeriodBar from '../components/period/PeriodBar';
import DataBanner from '../components/DataBanner';
import EChart from '../components/charts/EChart';
import ChartState from '../components/charts/ChartState';
import ExportCsvButton from '../components/ExportCsvButton';
import PrintButton from '../components/PrintButton';
import { usePeriod } from '../utils/period';
import { yen, num } from '../utils/format';
import { fmtDateTime } from '../utils/datetime';
import { TZ } from '../utils/tz';
import { api } from '../api';
import { PALETTE, baseGrid, catAxis, legend } from '../components/charts/chartTheme';

// 暴落分析(/pricing/crash)。GET /api/v1/pricing/crash-windows?start&end&day_mode。
//
// サーバ側の定義(routes/pricing.js の fetchCrashWindowsData)をそのまま画面の注記に反映している:
//   ・区間 = price_events の crash_manual 群(±60秒でグルーピング)で始まり、
//     対応する crash_reset 群で終わる。crash_reset が記録されていない区間は
//     開始 + 既定継続時間(meta.default_crash_minutes = 本番 pricingModel.CRASH_MINUTES)で閉じる
//   ・in_window = 区間内に注文された明細すべて(暴落していない銘柄も含む店全体の売れ行き)
//     crashed_items_* = 暴落した銘柄だけの内訳
//   ・reference = 直近4週の同曜日・同時間帯(同じ長さ)の平均。
//     会計が1件も無い週(休業日)は分母から外し、1週も残らなければ basis='none' で null
//   ・uplift_pct = in_window.quantity ÷ reference.quantity − 1
// CSV は /api/v1/export/csv?report=crash_windows。

const fmtYen = (v) => `¥${yen(v)}`;
const fmtNum = (v, d = 0) => (v == null ? '—' : num(v, d));
const fmtPct = (v) => (v == null ? '—' : `${num(v, 1)}%`);
// 増減率の符号付き表示(+12.5% / -8.0%)
const fmtSignedPct = (v) => {
  if (v == null) return '—';
  const n = Number(v);
  return `${n > 0 ? '+' : ''}${num(n, 1)}%`;
};

// ISO → JST の "HH:mm"(区間の開始・終了は時刻だけ見えれば足りる。日付は別列の営業日で示す)
const HM = new Intl.DateTimeFormat('ja-JP', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const fmtHm = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : HM.format(d);
};

// 増減率のトーン(色だけに頼らないよう、表では必ず数値と併記する)
function upliftTone(v) {
  if (v == null) return 'neutral';
  if (v > 0) return 'success';
  if (v < 0) return 'danger';
  return 'neutral';
}

export default function CrashWindowsPage() {
  const { period, isValid } = usePeriod();
  const { start, end, day_mode } = period;
  const params = { start, end, day_mode };

  const crashQ = useQuery({
    queryKey: ['v1', 'pricing', 'crash-windows', start, end, day_mode],
    queryFn: () => api.getPricingCrashWindows(params),
    enabled: isValid,
  });

  const windows = crashQ.data?.windows || [];
  const defaultMinutes = crashQ.data?.meta?.default_crash_minutes;
  // 表で選択中の区間(既定は先頭)。明細(暴落した銘柄)は選択した区間のものだけ出す
  const [selectedKey, setSelectedKey] = useState(null);
  const selected = useMemo(
    () => windows.find((w) => w.started_at === selectedKey) || windows[0] || null,
    [windows, selectedKey]
  );

  // KPI: 回数・延べ銘柄数・平均継続・区間内売上合計・増減率の平均(参照が取れた区間だけ)
  const kpi = useMemo(() => {
    const withRef = windows.filter((w) => w.uplift_pct != null);
    const noReset = windows.filter((w) => !w.reset_recorded).length;
    return {
      count: windows.length,
      itemCount: windows.reduce((a, w) => a + (w.item_count || 0), 0),
      avgMinutes: windows.length > 0 ? windows.reduce((a, w) => a + (w.minutes || 0), 0) / windows.length : null,
      revenue: windows.reduce((a, w) => a + (w.in_window?.revenue || 0), 0),
      quantity: windows.reduce((a, w) => a + (w.in_window?.quantity || 0), 0),
      avgUplift: withRef.length > 0 ? withRef.reduce((a, w) => a + w.uplift_pct, 0) / withRef.length : null,
      withRefCount: withRef.length,
      noReset,
    };
  }, [windows]);

  // 区間ごとの「区間内 vs 参照(直近4週同曜日・同時間帯の平均)」の数量比較
  const compareOption = useMemo(() => ({
    animation: false,
    grid: { ...baseGrid, bottom: 56 },
    legend: legend(),
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (ps) => {
        const i = ps?.[0]?.dataIndex ?? 0;
        const w = windows[i] || {};
        const ref = w.reference || {};
        return [
          `<div style="font-weight:600">${w.business_date ?? ''} ${fmtHm(w.started_at)}（${num(w.minutes, 1)}分・${w.item_count}銘柄）</div>`,
          `区間内 ${yen(w.in_window?.quantity)} 点 / ¥${yen(w.in_window?.revenue)}（会計 ${yen(w.in_window?.orders)} 件）`,
          `うち暴落銘柄 ${yen(w.crashed_items_quantity)} 点 / ¥${yen(w.crashed_items_revenue)}`,
          ref.basis === 'none'
            ? '参照: 直近4週に営業日がなく算出できません'
            : `参照 ${num(ref.quantity, 1)} 点 / ¥${yen(ref.revenue)}（${ref.weeks_used} 週平均）`,
          `増減率 ${fmtSignedPct(w.uplift_pct)}`,
        ].join('<br/>');
      },
    },
    xAxis: catAxis(
      windows.map((w) => `${w.business_date?.slice(5) ?? ''} ${fmtHm(w.started_at)}`),
      { axisLabel: { rotate: 45, fontSize: 10, color: PALETTE.axis } }
    ),
    yAxis: { type: 'value', axisLabel: { color: PALETTE.axis, formatter: (v) => `${v}点` }, splitLine: { lineStyle: { color: PALETTE.grid } } },
    series: [
      {
        name: '区間内の数量', type: 'bar',
        data: windows.map((w) => w.in_window?.quantity || 0),
        itemStyle: { color: PALETTE.blue, borderRadius: [3, 3, 0, 0] },
        barMaxWidth: 28,
      },
      {
        // 参照は「比較対象」なので muted + 破線の枠で、実測の棒と役割が違うことを形でも示す
        name: '参照（直近4週の同曜日・同時間帯 平均）', type: 'bar',
        data: windows.map((w) => (w.reference?.quantity == null ? null : w.reference.quantity)),
        itemStyle: { color: PALETTE.muted, borderRadius: [3, 3, 0, 0], borderType: 'dashed', borderColor: PALETTE.axis, borderWidth: 1 },
        barMaxWidth: 28,
      },
    ],
  }), [windows]);

  const WINDOW_COLUMNS = [
    { key: 'business_date', header: '営業日', width: 100, render: (w) => <span className="text-heading">{w.business_date}</span> },
    {
      key: 'time', header: '区間', width: 130,
      render: (w) => (
        <span className="tabular-nums text-body">
          {fmtHm(w.started_at)}〜{fmtHm(w.ended_at)}
        </span>
      ),
    },
    {
      key: 'minutes', header: '継続', align: 'right', width: 90,
      render: (w) => (
        <span className="tabular-nums">
          {num(w.minutes, 1)} 分
          {!w.reset_recorded && <span className="ml-1 text-2xs text-warning">推定</span>}
        </span>
      ),
    },
    { key: 'item_count', header: '銘柄数', align: 'right', width: 80, render: (w) => <span className="tabular-nums">{yen(w.item_count)}</span> },
    { key: 'in_qty', header: '区間内 数量', align: 'right', width: 100, render: (w) => <span className="tabular-nums">{yen(w.in_window?.quantity)} 点</span> },
    { key: 'in_rev', header: '区間内 売上', align: 'right', width: 110, render: (w) => <span className="tabular-nums">{fmtYen(w.in_window?.revenue)}</span> },
    { key: 'in_orders', header: '会計数', align: 'right', width: 80, render: (w) => <span className="tabular-nums text-muted">{yen(w.in_window?.orders)}</span> },
    {
      key: 'crashed', header: 'うち暴落銘柄', align: 'right', width: 120,
      render: (w) => <span className="tabular-nums text-muted">{yen(w.crashed_items_quantity)} 点 / {fmtYen(w.crashed_items_revenue)}</span>,
    },
    {
      key: 'ref', header: '参照 数量', align: 'right', width: 110,
      render: (w) => (
        w.reference?.basis === 'none'
          ? <span className="text-muted">—</span>
          : <span className="tabular-nums text-muted">{fmtNum(w.reference?.quantity, 1)} 点<span className="ml-1 text-2xs">({w.reference?.weeks_used}週)</span></span>
      ),
    },
    {
      key: 'uplift', header: '増減率', align: 'right', width: 100,
      render: (w) => (
        w.uplift_pct == null
          ? <span className="text-muted">—</span>
          : <Badge tone={upliftTone(w.uplift_pct)} size="sm">{fmtSignedPct(w.uplift_pct)}</Badge>
      ),
    },
  ];

  const ITEM_COLUMNS = [
    { key: 'name', header: '商品', render: (r) => <span className="text-heading font-medium">{r.name}</span> },
    { key: 'menu_item_id', header: 'ID', align: 'right', width: 70, render: (r) => <span className="tabular-nums text-muted">{r.menu_item_id}</span> },
    { key: 'price_before', header: '暴落前', align: 'right', width: 100, render: (r) => <span className="tabular-nums">{r.price_before == null ? '—' : fmtYen(r.price_before)}</span> },
    { key: 'crash_price', header: '暴落価格', align: 'right', width: 100, render: (r) => <span className="tabular-nums text-danger font-medium">{fmtYen(r.crash_price)}</span> },
    { key: 'drop_amount', header: '下げ幅', align: 'right', width: 100, render: (r) => <span className="tabular-nums">{r.drop_amount == null ? '—' : `-${fmtYen(r.drop_amount)}`}</span> },
    { key: 'drop_pct', header: '下げ率', align: 'right', width: 90, render: (r) => <span className="tabular-nums text-muted">{fmtPct(r.drop_pct)}</span> },
  ];

  return (
    <div className="space-y-5">
      <Toolbar
        title="暴落分析"
        subtitle={`暴落を打った区間の売れ行きと、直近4週の同曜日・同時間帯との比較（${day_mode === 'business' ? '営業日' : '暦日'}ベース）`}
      >
        <ExportCsvButton report="crash_windows" params={params} />
        <PrintButton />
      </Toolbar>
      <DataBanner />
      <Card dense>
        <PeriodBar />
      </Card>

      {!isValid && <Alert tone="warning">期間の指定が不正です。開始は終了以前の日付にしてください。</Alert>}
      {kpi.noReset > 0 && (
        <Alert tone="info" title="終了イベントが記録されていない区間があります">
          {kpi.noReset} 件の区間で crash_reset が見つからないため、既定の継続時間
          {defaultMinutes != null ? `（${defaultMinutes} 分）` : ''}で区間を閉じています（表の「継続」に「推定」と表示）。
          サーバ再起動などで復帰イベントが記録されなかった場合に起こります。
        </Alert>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatTile dense label="暴落回数" value={`${yen(kpi.count)} 回`} sub="crash_manual の発動グループ数" />
        <StatTile dense label="延べ暴落銘柄" value={`${yen(kpi.itemCount)} 件`} sub="区間 × 銘柄の合計" />
        <StatTile dense label="平均継続時間" value={kpi.avgMinutes == null ? '—' : `${num(kpi.avgMinutes, 1)} 分`} sub="発動から復帰まで" />
        <StatTile dense label="区間内の数量" value={`${yen(kpi.quantity)} 点`} sub="暴落中に売れた全明細" />
        <StatTile dense label="区間内の売上" value={fmtYen(kpi.revenue)} sub="暴落中の店全体の売上" />
        <StatTile
          dense label="平均増減率"
          value={fmtSignedPct(kpi.avgUplift)}
          /* 参照期間が取れても、その数量が0だと比率にならない（0除算）ので uplift は null になる。
             「参照が無い」と「参照が0点だった」を混同しないよう、算出できた区間数で言い分ける */
          sub={kpi.withRefCount > 0 ? `増減率を算出できた ${yen(kpi.withRefCount)} 区間の平均` : '増減率を算出できた区間がありません'}
        />
      </div>

      <Card title="区間内の数量と参照期間の比較" dense>
        <ChartState query={crashQ} height={320} isEmpty={(d) => !(d?.windows || []).length} emptyTitle="期間内に暴落の記録がありません">
          <EChart option={compareOption} height={320} />
        </ChartState>
        <p className="mt-2 text-2xs text-muted">
          青 = 暴落区間に売れた数量（暴落していない銘柄も含む店全体）、
          灰（破線枠）= 直近4週の同曜日・同じ時間帯・同じ長さの平均。
          会計が1件も無い週（休業日）は平均の分母から外しています。
        </p>
      </Card>

      <Card title="暴落区間の一覧" padded={false}>
        <ChartState query={crashQ} height={200} isEmpty={(d) => !(d?.windows || []).length} emptyTitle="期間内に暴落の記録がありません">
          <DataTable
            columns={WINDOW_COLUMNS}
            rows={windows}
            rowKey={(w) => w.started_at}
            onRowClick={(w) => setSelectedKey(w.started_at)}
            className={cn('border-0 rounded-none')}
          />
        </ChartState>
      </Card>

      {selected && (
        <Card
          title={`暴落した銘柄（${selected.business_date} ${fmtHm(selected.started_at)} の区間・${selected.item_count} 銘柄）`}
          padded={false}
          actions={<span className="text-2xs text-muted">行をクリックすると区間を切り替えます</span>}
        >
          <DataTable
            columns={ITEM_COLUMNS}
            rows={selected.items || []}
            rowKey={(r) => r.menu_item_id}
            className="border-0 rounded-none"
          />
          <div className="px-3 py-2 border-t border-line text-2xs text-muted">
            発動 {fmtDateTime(selected.started_at)} 〜 復帰 {fmtDateTime(selected.ended_at)}
            （{num(selected.minutes, 1)} 分{selected.reset_recorded ? '' : '・復帰イベント無しのため推定'}）。
            暴落価格は crash_floor（原価×1.2 と 寄り付き価格×比率 の高い方）で、約定はこの価格のまま通ります。
          </div>
        </Card>
      )}
    </div>
  );
}
