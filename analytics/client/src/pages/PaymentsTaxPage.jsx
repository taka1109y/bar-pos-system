import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Toolbar, Card, Alert, Tabs, StatTile, DataTable } from '../components/ui';
import PeriodBar from '../components/period/PeriodBar';
import DataBanner from '../components/DataBanner';
import EChart from '../components/charts/EChart';
import ChartState from '../components/charts/ChartState';
import ExportCsvButton from '../components/ExportCsvButton';
import { usePeriod } from '../utils/period';
import { yen, num } from '../utils/format';
import { shortDate } from '../utils/datetime';
import { api } from '../api';
import {
  PALETTE, CATEGORICAL, PAYMENT_COLORS, PAYMENT_LABELS,
  baseGrid, catAxis, yenAxis, legend, stackedBarItemStyle,
} from '../components/charts/chartTheme';

// 支払・税・取消。Tabs で 支払方法 / 税率別 / 割引・取消 を切り替える。
// 方法別金額は cash_amount/card_amount/emoney_amount の合計(分割会計対応)で、
// 金券は非現金として控除済み(サーバ側 /v1/sales/payments の定義)。

const TABS = [
  { id: 'pay', label: '支払方法' },
  { id: 'tax', label: '税率別' },
  { id: 'adj', label: '割引・取消' },
];

const numCell = (v, fmt = (x) => `¥${yen(x)}`) => <span className="tabular-nums">{fmt(v)}</span>;

export default function PaymentsTaxPage() {
  const { period, isValid } = usePeriod();
  const { start, end, day_mode } = period;
  const [tab, setTab] = useState('pay');
  const common = { start, end, day_mode };

  const payQ = useQuery({
    queryKey: ['v1', 'payments', start, end, day_mode],
    queryFn: () => api.getSalesPayments(common),
    enabled: isValid && tab === 'pay',
  });
  const taxQ = useQuery({
    queryKey: ['v1', 'tax', start, end, day_mode],
    queryFn: () => api.getSalesTax(common),
    enabled: isValid && tab === 'tax',
  });
  const adjQ = useQuery({
    queryKey: ['v1', 'adjustments', start, end, day_mode],
    queryFn: () => api.getSalesAdjustments(common),
    enabled: isValid && tab === 'adj',
  });

  // ── 支払方法 ──
  const pay = payQ.data;
  const payPieOption = useMemo(() => {
    const methods = pay?.methods || [];
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
        type: 'pie', radius: ['55%', '78%'], center: ['50%', '45%'], data,
        itemStyle: { borderColor: PALETTE.surface, borderWidth: 2 },
        label: { show: false },
        emphasis: { scaleSize: 4 },
      }],
    };
  }, [pay]);

  const payDailyOption = useMemo(() => {
    const rows = pay?.by_day || [];
    const mk = (key) => ({
      name: PAYMENT_LABELS[key], type: 'bar', stack: 'pay',
      data: rows.map((r) => Math.round(r[key] || 0)),
      itemStyle: { color: PAYMENT_COLORS[key], ...stackedBarItemStyle },
      barMaxWidth: 28,
    });
    return {
      animation: false,
      grid: baseGrid,
      legend: legend(),
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (ps) => {
          const i = ps?.[0]?.dataIndex ?? 0;
          const r = rows[i] || {};
          const total = (Number(r.cash) || 0) + (Number(r.card) || 0) + (Number(r.emoney) || 0);
          return [
            `<div style="font-weight:600">${r.date ?? ''}</div>`,
            `現金 ¥${yen(r.cash)} / カード ¥${yen(r.card)} / 電子マネー ¥${yen(r.emoney)}`,
            `合計 ¥${yen(total)}`,
          ].join('<br/>');
        },
      },
      xAxis: catAxis(rows.map((r) => shortDate(r.date))),
      yAxis: yenAxis(),
      series: [mk('cash'), mk('card'), mk('emoney')],
    };
  }, [pay]);

  const METHOD_COLUMNS = [
    { key: 'label', header: '支払方法', render: (r) => <span className="text-heading">{r.label || PAYMENT_LABELS[r.method] || r.method}</span> },
    { key: 'count', header: '件数', align: 'right', render: (r) => numCell(r.count, (v) => `${yen(v)} 件`) },
    { key: 'amount', header: '金額', align: 'right', render: (r) => numCell(r.amount) },
  ];

  const CHARGE_COLUMNS = [
    { key: 'charge_per_person', header: '1人あたり', align: 'right', render: (r) => numCell(r.charge_per_person) },
    { key: 'count', header: '件数', align: 'right', render: (r) => numCell(r.count, (v) => `${yen(v)} 件`) },
    { key: 'amount', header: '金額', align: 'right', render: (r) => numCell(r.amount) },
  ];

  // ── 税率別 ──
  const tax = taxQ.data;
  const taxDailyOption = useMemo(() => {
    const rows = tax?.by_day || [];
    const mk = (key, name, color) => ({
      name, type: 'bar', stack: 'tax',
      data: rows.map((r) => Math.round(r[key] || 0)),
      itemStyle: { color, ...stackedBarItemStyle },
      barMaxWidth: 28,
    });
    return {
      animation: false,
      grid: baseGrid,
      legend: legend(),
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (ps) => {
          const i = ps?.[0]?.dataIndex ?? 0;
          const r = rows[i] || {};
          return [
            `<div style="font-weight:600">${r.date ?? ''}</div>`,
            `標準10% ¥${yen(r.taxable_standard)} / 軽減8% ¥${yen(r.taxable_reduced)}`,
          ].join('<br/>');
        },
      },
      xAxis: catAxis(rows.map((r) => shortDate(r.date))),
      yAxis: yenAxis(),
      series: [
        mk('taxable_standard', '標準10%(課税対象)', PALETTE.blue),
        mk('taxable_reduced', '軽減8%(課税対象)', PALETTE.emerald),
      ],
    };
  }, [tax]);

  const TAX_COLUMNS = [
    { key: 'date', header: '日付', render: (r) => <span className="text-heading tabular-nums">{r.date}</span> },
    { key: 'taxable_standard', header: '標準10%(課税対象)', align: 'right', render: (r) => numCell(r.taxable_standard) },
    { key: 'taxable_reduced', header: '軽減8%(課税対象)', align: 'right', render: (r) => numCell(r.taxable_reduced) },
  ];

  // ── 割引・取消 ──
  const adj = adjQ.data;
  const adjDailyOption = useMemo(() => {
    const rows = adj?.by_day || [];
    const mk = (key, name, color) => ({
      name, type: 'bar', stack: 'adj',
      data: rows.map((r) => Math.round(r[key] || 0)),
      itemStyle: { color, ...stackedBarItemStyle },
      barMaxWidth: 28,
    });
    return {
      animation: false,
      grid: baseGrid,
      legend: legend(),
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (ps) => {
          const i = ps?.[0]?.dataIndex ?? 0;
          const r = rows[i] || {};
          return [
            `<div style="font-weight:600">${r.date ?? ''}</div>`,
            `割引 ¥${yen(r.discount_amount)} / 取消(void) ¥${yen(r.void_amount)} / 赤伝票 ¥${yen(r.red_amount)}`,
          ].join('<br/>');
        },
      },
      xAxis: catAxis(rows.map((r) => shortDate(r.date))),
      yAxis: yenAxis(),
      series: [
        mk('discount_amount', '割引', CATEGORICAL[0]),
        mk('void_amount', '取消(void)', CATEGORICAL[1]),
        mk('red_amount', '赤伝票', CATEGORICAL[2]),
      ],
    };
  }, [adj]);

  const ADJ_COLUMNS = [
    { key: 'date', header: '日付', render: (r) => <span className="text-heading tabular-nums">{r.date}</span> },
    { key: 'discount_amount', header: '割引', align: 'right', render: (r) => numCell(r.discount_amount) },
    { key: 'void_amount', header: '取消(void)', align: 'right', render: (r) => numCell(r.void_amount) },
    { key: 'red_amount', header: '赤伝票', align: 'right', render: (r) => numCell(r.red_amount) },
  ];

  const csvReport = tab === 'pay' ? 'payments' : tab === 'tax' ? 'tax' : 'adjustments';

  return (
    <div className="space-y-5">
      <Toolbar title="支払・税・取消" subtitle={`支払方法・税率別・割引/取消の内訳(${day_mode === 'business' ? '営業日' : '暦日'}ベース)`}>
        <ExportCsvButton report={csvReport} params={common} />
      </Toolbar>
      <DataBanner />
      <Card dense>
        <PeriodBar />
      </Card>

      {!isValid && <Alert tone="warning">期間の指定が不正です。開始は終了以前の日付にしてください。</Alert>}

      <Tabs tabs={TABS} activeId={tab} onChange={setTab} />

      {tab === 'pay' && (
        <div className="space-y-5">
          {payQ.isError && <Alert tone="danger" title="支払集計を取得できません">{payQ.error?.message}</Alert>}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
            <StatTile dense label="分割会計" value={pay ? `${yen(pay.split_count)} 件` : '—'} sub="2方法以上で支払った会計" />
            <StatTile dense label="金券(釣り無し)" value={pay ? `¥${yen(pay.gift?.no_change_amount)}` : '—'} sub={pay ? `${yen(pay.gift?.no_change_count)} 件` : undefined} />
            <StatTile dense label="金券(釣り有り)" value={pay ? `¥${yen(pay.gift?.change_amount)}` : '—'} sub={pay ? `${yen(pay.gift?.change_count)} 件` : undefined} />
            <StatTile dense label="チャージ" value={pay ? `¥${yen(pay.charge?.amount)}` : '—'} sub={pay ? `${yen(pay.charge?.count)} 件` : undefined} />
            <StatTile dense label="深夜料金" value={pay ? `¥${yen(pay.late_night?.amount)}` : '—'} sub={pay ? `${yen(pay.late_night?.count)} 件` : undefined} />
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
            <Card title="方法別構成比" dense>
              <ChartState query={payQ} height={280} isEmpty={(d) => !(d?.methods || []).some((m) => Number(m.amount) > 0)}>
                <EChart option={payPieOption} height={280} />
              </ChartState>
            </Card>
            <Card title="日別内訳(積み上げ)" dense className="xl:col-span-2">
              <ChartState query={payQ} height={280} isEmpty={(d) => !(d?.by_day || []).length}>
                <EChart option={payDailyOption} height={280} />
              </ChartState>
            </Card>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            <Card title="方法別金額" padded={false}>
              <DataTable columns={METHOD_COLUMNS} rows={pay?.methods || []} rowKey={(r) => r.method} className="border-0 rounded-none" />
            </Card>
            <Card title="チャージ内訳(単価別)" padded={false}>
              <DataTable columns={CHARGE_COLUMNS} rows={pay?.charge?.by_per_person || []} rowKey={(r, i) => r.charge_per_person ?? i} className="border-0 rounded-none" />
            </Card>
          </div>
          <p className="text-2xs text-muted">
            方法別金額は cash_amount/card_amount/emoney_amount の合計(分割会計は方法別に按分済み)。金券は非現金として控除済み。
          </p>
        </div>
      )}

      {tab === 'tax' && (
        <div className="space-y-5">
          {taxQ.isError && <Alert tone="danger" title="税率別集計を取得できません">{taxQ.error?.message}</Alert>}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
            <StatTile dense label="課税対象(標準10%)" value={tax ? `¥${yen(tax.taxable_standard)}` : '—'} />
            <StatTile dense label="消費税(標準10%)" value={tax ? `¥${yen(tax.tax_standard)}` : '—'} />
            <StatTile dense label="課税対象(軽減8%)" value={tax ? `¥${yen(tax.taxable_reduced)}` : '—'} />
            <StatTile dense label="消費税(軽減8%)" value={tax ? `¥${yen(tax.tax_reduced)}` : '—'} />
            <StatTile dense label="記録済み税額合計" value={tax ? `¥${yen(tax.total_tax_recorded)}` : '—'} sub="会計時に保存した tax_amount" />
          </div>
          <Card title="日別課税対象額(税率別)" dense>
            <ChartState query={taxQ} height={280} isEmpty={(d) => !(d?.by_day || []).length}>
              <EChart option={taxDailyOption} height={280} />
            </ChartState>
          </Card>
          <Card title="日別明細" padded={false}>
            <ChartState query={taxQ} height={160} isEmpty={(d) => !(d?.by_day || []).length}>
              <DataTable columns={TAX_COLUMNS} rows={tax?.by_day || []} rowKey={(r) => r.date} className="border-0 rounded-none" />
            </ChartState>
          </Card>
          <p className="text-2xs text-muted">
            全価格は税込み(内税)。税額は課税対象額からの逆算(表示用)で、レジクローズの日次レポートと同じ式を期間に広げたもの。
          </p>
        </div>
      )}

      {tab === 'adj' && (
        <div className="space-y-5">
          {adjQ.isError && <Alert tone="danger" title="割引・取消集計を取得できません">{adjQ.error?.message}</Alert>}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StatTile dense label="割引" value={adj ? `¥${yen(adj.discount?.amount)}` : '—'} sub={adj ? `${yen(adj.discount?.count)} 件` : undefined} />
            <StatTile dense label="取消(void)" value={adj ? `¥${yen(adj.void?.amount)}` : '—'} sub={adj ? `${yen(adj.void?.count)} 件` : undefined} />
            <StatTile dense label="赤伝票" value={adj ? `¥${yen(adj.red?.amount)}` : '—'} sub={adj ? `${yen(adj.red?.count)} 件` : undefined} />
          </div>
          <Card title="日別内訳" dense>
            <ChartState query={adjQ} height={280} isEmpty={(d) => !(d?.by_day || []).length} emptyTitle="期間内に割引・取消はありません">
              <EChart option={adjDailyOption} height={280} />
            </ChartState>
          </Card>
          <Card title="日別明細" padded={false}>
            <ChartState query={adjQ} height={160} isEmpty={(d) => !(d?.by_day || []).length} emptyTitle="期間内に割引・取消はありません">
              <DataTable columns={ADJ_COLUMNS} rows={adj?.by_day || []} rowKey={(r) => r.date} className="border-0 rounded-none" />
            </ChartState>
          </Card>
          <Alert tone="info">
            {adjQ.data?.meta?.note || 'void/red の日付は取消操作を行った時刻(closed_at)基準です。元の会計日ではありません。'}
          </Alert>
        </div>
      )}
    </div>
  );
}
