import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Toolbar, Card, Alert, DataTable, StatTile } from '../components/ui';
import PeriodBar from '../components/period/PeriodBar';
import DataBanner from '../components/DataBanner';
import EChart from '../components/charts/EChart';
import ChartState from '../components/charts/ChartState';
import { usePeriod } from '../utils/period';
import { yen, num } from '../utils/format';
import { api } from '../api';
import { PALETTE, baseGrid, catAxis, yenAxis } from '../components/charts/chartTheme';

// 客数・客単価。組人数(何人組が多いか)と1人あたり支払額(500円刻み)の分布を見る。
// 集計は paid オーダーベース(取消しは除外)。客単価 = total_amount / guest_count(guest_count>0 のみ)。

// 件数用の値軸(円フォーマットを使わない)
const countAxis = () => ({
  type: 'value',
  axisLabel: { color: PALETTE.axis },
  splitLine: { lineStyle: { color: PALETTE.grid } },
});

export default function SeatsGuestsPage() {
  const { period, isValid } = usePeriod();
  const { start, end, day_mode } = period;

  const guestsQ = useQuery({
    queryKey: ['v1', 'seats', 'guests', start, end, day_mode],
    queryFn: () => api.getSeatsGuests({ start, end, day_mode }),
    enabled: isValid,
  });

  const summary = guestsQ.data?.summary;
  const partySize = guestsQ.data?.party_size || [];
  const perGuestBins = guestsQ.data?.per_guest_bins || [];

  // タイル用の合計(組数・総客数)は party_size 行から復元する
  const totals = useMemo(() => {
    const orders = partySize.reduce((a, r) => a + (Number(r.order_count) || 0), 0);
    const guests = partySize.reduce((a, r) => a + (Number(r.guest_count) || 0) * (Number(r.order_count) || 0), 0);
    return { orders, guests };
  }, [partySize]);

  const partyOption = useMemo(() => ({
    animation: false,
    grid: baseGrid,
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (ps) => {
        const i = ps?.[0]?.dataIndex ?? 0;
        const r = partySize[i] || {};
        return [
          `<div style="font-weight:600">${r.guest_count}人組</div>`,
          `${yen(r.order_count)} 組 / 売上 ¥${yen(r.revenue)}`,
        ].join('<br/>');
      },
    },
    xAxis: catAxis(partySize.map((r) => `${r.guest_count}人`)),
    yAxis: countAxis(),
    series: [{
      name: '組数', type: 'bar',
      data: partySize.map((r) => Number(r.order_count) || 0),
      itemStyle: { color: PALETTE.blue, borderRadius: [3, 3, 0, 0] },
      barMaxWidth: 32,
    }],
  }), [partySize]);

  const binsOption = useMemo(() => {
    const many = perGuestBins.length > 12;
    return {
      animation: false,
      grid: { ...baseGrid, bottom: many ? 56 : 40 },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (ps) => {
          const i = ps?.[0]?.dataIndex ?? 0;
          const b = perGuestBins[i] || {};
          return `¥${yen(b.min)}〜¥${yen(b.max)}<br/>${yen(b.count)} 人`;
        },
      },
      xAxis: catAxis(perGuestBins.map((b) => `¥${yen(b.min)}〜`), {
        axisLabel: { rotate: many ? 40 : 0, fontSize: 10, interval: 0 },
      }),
      yAxis: countAxis(),
      series: [{
        name: '人数', type: 'bar',
        data: perGuestBins.map((b) => Number(b.count) || 0),
        itemStyle: { color: PALETTE.blue, borderRadius: [3, 3, 0, 0] },
        barMaxWidth: 32,
      }],
    };
  }, [perGuestBins]);

  const PARTY_COLUMNS = [
    { key: 'guest_count', header: '組人数', width: 80, render: (r) => <span className="text-heading font-medium tabular-nums">{r.guest_count} 人</span> },
    { key: 'order_count', header: '組数', align: 'right', width: 90, render: (r) => <span className="tabular-nums">{yen(r.order_count)}</span> },
    { key: 'revenue', header: '売上', align: 'right', render: (r) => <span className="tabular-nums">¥{yen(r.revenue)}</span> },
    {
      key: 'share', header: '組数構成比', align: 'right', width: 100,
      render: (r) => <span className="tabular-nums">{totals.orders > 0 ? `${num((Number(r.order_count) / totals.orders) * 100, 1)}%` : '—'}</span>,
    },
  ];

  return (
    <div className="space-y-5">
      <Toolbar title="客数・客単価" subtitle={`組人数と1人あたり支払額の分布(${day_mode === 'business' ? '営業日' : '暦日'}ベース)`} />
      <DataBanner />
      <Card dense>
        <PeriodBar />
      </Card>

      {!isValid && <Alert tone="warning">期間の指定が不正です。開始は終了以前の日付にしてください。</Alert>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatTile dense label="平均組人数" value={summary ? `${num(summary.avg_party_size, 1)} 人` : '—'} />
        <StatTile dense label="平均客単価" value={summary ? `¥${yen(summary.avg_per_guest)}` : '—'} sub="1人あたり支払額" />
        <StatTile dense label="会計組数" value={guestsQ.data ? `${yen(totals.orders)} 組` : '—'} />
        <StatTile dense label="総客数" value={guestsQ.data ? `${yen(totals.guests)} 人` : '—'} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 items-start">
        <Card title="組人数の分布" dense>
          <ChartState query={guestsQ} height={280} isEmpty={(d) => !(d?.party_size || []).length} emptyTitle="期間内に会計データがありません">
            <EChart option={partyOption} height={280} />
          </ChartState>
          <p className="mt-2 text-2xs text-muted">0人組はチャージ0円・飲み直しの会計。取消し(void/black_cancelled)は除外。</p>
        </Card>
        <Card title="客単価の分布(500円刻み)" dense>
          <ChartState query={guestsQ} height={280} isEmpty={(d) => !(d?.per_guest_bins || []).length} emptyTitle="期間内に会計データがありません">
            <EChart option={binsOption} height={280} />
          </ChartState>
          <p className="mt-2 text-2xs text-muted">客単価 = 会計金額 ÷ 人数(0人組は対象外)。縦軸は該当する人数。</p>
        </Card>
      </div>

      <Card title="組人数別の明細" padded={false}>
        <ChartState query={guestsQ} height={160} isEmpty={(d) => !(d?.party_size || []).length} emptyTitle="期間内に会計データがありません">
          <DataTable columns={PARTY_COLUMNS} rows={partySize} rowKey={(r) => r.guest_count} className="border-0 rounded-none" />
        </ChartState>
      </Card>
    </div>
  );
}
