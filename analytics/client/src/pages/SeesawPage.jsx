import { useMemo } from 'react';
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
import { api } from '../api';
import { PALETTE, baseGrid, catAxis, legend } from '../components/charts/chartTheme';

// シーソー分析(/pricing/seesaw)。GET /api/v1/pricing/seesaw?start&end&day_mode。
//
// サーバ側の定義(routes/pricing.js の fetchSeesawData)をそのまま画面の注記に反映している:
//   ・シーソー = 注文された銘柄(勝ち)が +k 段上がり、その上昇分を同カテゴリの他銘柄へ
//     −1 段ずつ配分する(段ベースのゼロサム)。負け側が常に1段なのはこの設計によるもの
//   ・段数 = (price_after − price_before) ÷ 呼値 の絶対値(四捨五入)。呼値は本番
//     server/services/pricingModel.js の gridStep(現行 base_price から算出)を使うため、
//     期間中に定価を改定した銘柄はズレ得る
//   ・呼値が定義できない銘柄(定価0の時価商品)は段数に数えられず unknown_step_events に出る
//   ・寄り付き(market_open) = engine_enabled のドリンクを寄り付き価格(n=0)へ戻す操作の実施記録
// CSV は /api/v1/export/csv?report=seesaw。

const WIN_COLOR = PALETTE.emerald;  // 勝ち(上昇)
const LOSE_COLOR = '#dc2626';       // 負け(下降)。red-600(chartTheme SERIES10 と同じ値)

const fmtSteps = (v) => `${yen(v)} 段`;
const avgSteps = (r) => (r.count > 0 ? r.total_steps / r.count : null);
const fmtAvg = (v) => (v == null ? '—' : `${num(v, 2)} 段`);

const TOP_N = 12; // チャートに出す銘柄数(表には全件出す)

export default function SeesawPage() {
  const { period, isValid } = usePeriod();
  const { start, end, day_mode } = period;
  const params = { start, end, day_mode };

  const seesawQ = useQuery({
    queryKey: ['v1', 'pricing', 'seesaw', start, end, day_mode],
    queryFn: () => api.getPricingSeesaw(params),
    enabled: isValid,
  });

  const win = seesawQ.data?.win || { count: 0, items: [] };
  const lose = seesawQ.data?.lose || { count: 0, items: [] };
  const dist = seesawQ.data?.step_distribution || [];
  const distLose = seesawQ.data?.step_distribution_lose || [];
  const marketOpen = seesawQ.data?.market_open || [];
  const unknownSteps = seesawQ.data?.unknown_step_events || 0;

  const winTotalSteps = win.items.reduce((a, r) => a + r.total_steps, 0);
  const loseTotalSteps = lose.items.reduce((a, r) => a + r.total_steps, 0);

  // 銘柄別に勝ち・負けを突き合わせた表。差引段数 = 勝ちの合計段数 − 負けの合計段数
  const itemRows = useMemo(() => {
    const map = new Map();
    const put = (r, side) => {
      const cur = map.get(r.menu_item_id)
        || { menu_item_id: r.menu_item_id, name: r.name, win_count: 0, win_steps: 0, lose_count: 0, lose_steps: 0 };
      cur[`${side}_count`] += r.count;
      cur[`${side}_steps`] += r.total_steps;
      map.set(r.menu_item_id, cur);
    };
    for (const r of win.items) put(r, 'win');
    for (const r of lose.items) put(r, 'lose');
    return [...map.values()]
      .map((r) => ({ ...r, net_steps: r.win_steps - r.lose_steps }))
      .sort((a, b) => b.net_steps - a.net_steps || b.win_count - a.win_count || a.name.localeCompare(b.name));
  }, [win.items, lose.items]);

  // 段数分布(勝ち・負けを同じ段目盛りに並べる)
  const distOption = useMemo(() => {
    const steps = [...new Set([...dist.map((r) => r.steps), ...distLose.map((r) => r.steps)])].sort((a, b) => a - b);
    const winMap = new Map(dist.map((r) => [r.steps, r.count]));
    const loseMap = new Map(distLose.map((r) => [r.steps, r.count]));
    return {
      animation: false,
      grid: baseGrid,
      legend: legend(),
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v) => `${yen(v)} 回` },
      xAxis: catAxis(steps.map((s) => `${s} 段`)),
      yAxis: { type: 'value', axisLabel: { color: PALETTE.axis, formatter: (v) => `${v}回` }, splitLine: { lineStyle: { color: PALETTE.grid } } },
      series: [
        {
          name: '勝ち（上昇）', type: 'bar',
          data: steps.map((s) => winMap.get(s) || 0),
          itemStyle: { color: WIN_COLOR, borderRadius: [3, 3, 0, 0] },
          barMaxWidth: 40,
        },
        {
          name: '負け（下降）', type: 'bar',
          data: steps.map((s) => loseMap.get(s) || 0),
          itemStyle: { color: LOSE_COLOR, borderRadius: [3, 3, 0, 0] },
          barMaxWidth: 40,
        },
      ],
    };
  }, [dist, distLose]);

  // 銘柄別の段数(横棒。差引段数の大きい順に上位/下位を切り出す)
  const itemOption = useMemo(() => {
    const top = itemRows.slice(0, TOP_N);
    // 横棒は下から積まれるので、上に来てほしい順(差引の大きい順)を reverse して渡す
    const rows = [...top].reverse();
    return {
      animation: false,
      grid: { left: 140, right: 24, top: 28, bottom: 32 },
      legend: legend(),
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (ps) => {
          const i = ps?.[0]?.dataIndex ?? 0;
          const r = rows[i] || {};
          return [
            `<div style="font-weight:600">${r.name ?? ''}</div>`,
            `勝ち ${yen(r.win_count)} 回 / 合計 ${fmtSteps(r.win_steps)}`,
            `負け ${yen(r.lose_count)} 回 / 合計 ${fmtSteps(r.lose_steps)}`,
            `差引 ${r.net_steps > 0 ? '+' : ''}${yen(r.net_steps)} 段`,
          ].join('<br/>');
        },
      },
      xAxis: { type: 'value', axisLabel: { color: PALETTE.axis, formatter: (v) => `${v}段` }, splitLine: { lineStyle: { color: PALETTE.grid } } },
      yAxis: catAxis(rows.map((r) => r.name), { axisTick: { show: false }, axisLabel: { fontSize: 11, color: PALETTE.axis, width: 130, overflow: 'truncate' } }),
      series: [
        {
          name: '上昇（勝ち）', type: 'bar', stack: 'steps',
          data: rows.map((r) => r.win_steps),
          itemStyle: { color: WIN_COLOR },
          barMaxWidth: 16,
        },
        {
          // 下降は負の向きに描いて、上昇と打ち消し合う関係が形で読めるようにする
          name: '下降（負け）', type: 'bar', stack: 'steps',
          data: rows.map((r) => -r.lose_steps),
          itemStyle: { color: LOSE_COLOR },
          barMaxWidth: 16,
        },
      ],
    };
  }, [itemRows]);

  const ITEM_COLUMNS = [
    {
      key: 'name', header: '商品',
      render: (r) => <span className={cn(r._total ? 'font-semibold text-heading' : 'text-heading font-medium')}>{r.name}</span>,
    },
    { key: 'win_count', header: '勝ち回数', align: 'right', width: 90, render: (r) => <span className={cn('tabular-nums', r._total && 'font-semibold text-heading')}>{yen(r.win_count)} 回</span> },
    { key: 'win_steps', header: '上昇 合計段数', align: 'right', width: 120, render: (r) => <span className={cn('tabular-nums text-success', r._total && 'font-semibold')}>{fmtSteps(r.win_steps)}</span> },
    {
      key: 'win_avg', header: '上昇 平均段数', align: 'right', width: 120,
      render: (r) => <span className="tabular-nums text-muted">{fmtAvg(avgSteps({ count: r.win_count, total_steps: r.win_steps }))}</span>,
    },
    { key: 'lose_count', header: '負け回数', align: 'right', width: 90, render: (r) => <span className={cn('tabular-nums', r._total && 'font-semibold text-heading')}>{yen(r.lose_count)} 回</span> },
    { key: 'lose_steps', header: '下降 合計段数', align: 'right', width: 120, render: (r) => <span className={cn('tabular-nums text-danger', r._total && 'font-semibold')}>{fmtSteps(r.lose_steps)}</span> },
    {
      key: 'net_steps', header: '差引段数', align: 'right', width: 110,
      render: (r) => (
        r._total
          ? <span className="tabular-nums font-semibold text-heading">{r.net_steps > 0 ? '+' : ''}{yen(r.net_steps)} 段</span>
          : (
            <Badge tone={r.net_steps > 0 ? 'success' : r.net_steps < 0 ? 'danger' : 'neutral'} size="sm">
              {r.net_steps > 0 ? '+' : ''}{yen(r.net_steps)} 段
            </Badge>
          )
      ),
    },
  ];

  const itemTableRows = useMemo(() => {
    if (itemRows.length === 0) return [];
    return [...itemRows, {
      _total: true,
      menu_item_id: 'total',
      name: '合計',
      win_count: win.count,
      win_steps: winTotalSteps,
      lose_count: lose.count,
      lose_steps: loseTotalSteps,
      net_steps: winTotalSteps - loseTotalSteps,
    }];
  }, [itemRows, win.count, lose.count, winTotalSteps, loseTotalSteps]);

  const OPEN_COLUMNS = [
    { key: 'occurred_at', header: '実施日時', render: (r) => <span className="text-heading tabular-nums">{fmtDateTime(r.occurred_at)}</span> },
    { key: 'changed_count', header: '価格が動いた銘柄数', align: 'right', width: 160, render: (r) => <span className="tabular-nums">{yen(r.changed_count)} 件</span> },
  ];

  return (
    <div className="space-y-5">
      <Toolbar
        title="シーソー分析"
        subtitle={`注文で上がった銘柄と、その分だけ下げられた同カテゴリの銘柄（${day_mode === 'business' ? '営業日' : '暦日'}ベース）`}
      >
        <ExportCsvButton report="seesaw" params={params} />
        <PrintButton />
      </Toolbar>
      <DataBanner />
      <Card dense>
        <PeriodBar />
      </Card>

      {!isValid && <Alert tone="warning">期間の指定が不正です。開始は終了以前の日付にしてください。</Alert>}
      {unknownSteps > 0 && (
        <Alert tone="info" title="段数を数えられないイベントがあります">
          定価（base_price）が 0 の商品は呼値（1段の値幅）を定義できないため、{yen(unknownSteps)} 件のイベントを
          段数の集計から除いています（回数には含まれます）。
        </Alert>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatTile dense label="勝ち（上昇）回数" value={`${yen(win.count)} 回`} sub={`${yen(win.items.length)} 銘柄`} />
        <StatTile dense label="負け（下降）回数" value={`${yen(lose.count)} 回`} sub={`${yen(lose.items.length)} 銘柄`} />
        <StatTile dense label="上昇 合計段数" value={fmtSteps(winTotalSteps)} sub="勝ち側が押し上げた段の総和" />
        <StatTile dense label="下降 合計段数" value={fmtSteps(loseTotalSteps)} sub="犠牲側へ配分された段の総和" />
        <StatTile
          dense label="平均上昇段数"
          value={fmtAvg(avgSteps({ count: win.count, total_steps: winTotalSteps }))}
          sub="1回の注文あたりの上げ幅"
        />
        <StatTile dense label="寄り付き（価格リセット）" value={`${yen(marketOpen.length)} 回`} sub="期間内の market_open 実施回数" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title="段数の分布" dense>
          <ChartState query={seesawQ} height={300} isEmpty={() => dist.length === 0 && distLose.length === 0} emptyTitle="期間内にシーソーの記録がありません">
            <EChart option={distOption} height={300} />
          </ChartState>
          <p className="mt-2 text-2xs text-muted">
            勝ちの上昇段は抽選（+1〜+k 段）で決まり、その分が同カテゴリの他銘柄へ −1 段ずつ配分されます。
            負け側が 1 段しか出ないのは、この「1段ずつ配る」ゼロサム設計によるものです。
          </p>
        </Card>

        <Card title={`銘柄別の上昇・下降（差引の上位 ${TOP_N} 件）`} dense>
          <ChartState query={seesawQ} height={300} isEmpty={() => itemRows.length === 0} emptyTitle="期間内にシーソーの記録がありません">
            <EChart option={itemOption} height={300} />
          </ChartState>
          <p className="mt-2 text-2xs text-muted">
            緑（右）= 注文で上がった段、赤（左）= 他銘柄の上昇に伴って下げられた段。
            差引が正の銘柄は期間を通じて値上がり方向、負の銘柄は値下がり方向に押されています。
          </p>
        </Card>
      </div>

      <Card title="銘柄別の明細" padded={false}>
        <ChartState query={seesawQ} height={200} isEmpty={() => itemRows.length === 0} emptyTitle="期間内にシーソーの記録がありません">
          <DataTable
            columns={ITEM_COLUMNS}
            rows={itemTableRows}
            rowKey={(r) => r.menu_item_id}
            className="border-0 rounded-none"
          />
        </ChartState>
      </Card>

      <Card title="寄り付き（価格リセット）の実施記録" padded={false}>
        <DataTable
          columns={OPEN_COLUMNS}
          rows={marketOpen}
          rowKey={(r) => r.occurred_at}
          className="border-0 rounded-none"
          empty={<div className="py-10 text-center text-sm text-muted">期間内に寄り付き（価格リセット）の記録がありません</div>}
        />
        <div className="px-3 py-2 border-t border-line text-2xs text-muted">
          寄り付きは価格変動対象のドリンクを寄り付き価格（帯の中心）へ戻す操作です。レジオープンでは自動発火せず、
          スタッフが POS の「システム管理 &gt; 価格モデル」から手動で実行します。運用ルールでは取引ナイト（金・土）の
          営業開始時に必ず実施します。
        </div>
      </Card>
    </div>
  );
}
