import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Toolbar, Card, Alert, Field, Select, StatTile } from '../components/ui';
import PeriodBar from '../components/period/PeriodBar';
import DataBanner from '../components/DataBanner';
import EChart from '../components/charts/EChart';
import ChartState from '../components/charts/ChartState';
import ExportCsvButton from '../components/ExportCsvButton';
import { usePeriod } from '../utils/period';
import { yen, num } from '../utils/format';
import { api } from '../api';
import { PALETTE, baseGrid, catAxis } from '../components/charts/chartTheme';

// 滞在時間の分布。paid オーダーの opened_at→closed_at を分単位で集計(即会計テーブルは除外)。
// bin_minutes で階級幅を切り替え。CSV は /api/v1/export/csv?report=stay_distribution。

const BIN_OPTIONS = [5, 10, 15, 20, 30, 60].map((v) => ({ value: String(v), label: `${v}分` }));

// bucket → 軸ラベル。末尾の開区間(max なし)は「N分〜」
const bucketLabel = (b) =>
  (b.max_minutes == null ? `${yen(b.min_minutes)}分〜` : `${yen(b.min_minutes)}〜${yen(b.max_minutes)}分`);

export default function SeatsStayPage() {
  const { period, isValid } = usePeriod();
  const { start, end, day_mode } = period;
  const [binMinutes, setBinMinutes] = useState('15');

  const params = { start, end, day_mode, bin_minutes: binMinutes };
  const stayQ = useQuery({
    queryKey: ['v1', 'seats', 'stay', start, end, day_mode, binMinutes],
    queryFn: () => api.getSeatsStay(params),
    enabled: isValid,
  });

  const d = stayQ.data;
  const buckets = d?.buckets || [];
  const p = d?.percentiles;

  const option = useMemo(() => {
    const many = buckets.length > 14;
    return {
      animation: false,
      grid: { ...baseGrid, bottom: many ? 64 : 44 },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (ps) => {
          const i = ps?.[0]?.dataIndex ?? 0;
          const b = buckets[i] || {};
          return `${bucketLabel(b)}<br/>${yen(b.count)} 組`;
        },
      },
      xAxis: catAxis(buckets.map(bucketLabel), {
        axisLabel: { rotate: many ? 40 : 20, fontSize: 10, interval: 0 },
      }),
      yAxis: {
        type: 'value',
        axisLabel: { color: PALETTE.axis },
        splitLine: { lineStyle: { color: PALETTE.grid } },
      },
      series: [{
        name: '組数', type: 'bar',
        data: buckets.map((b) => Number(b.count) || 0),
        itemStyle: { color: PALETTE.blue, borderRadius: [3, 3, 0, 0] },
        barMaxWidth: 36,
      }],
    };
  }, [buckets]);

  return (
    <div className="space-y-5">
      <Toolbar title="滞在時間" subtitle={`会計までの滞在時間の分布(${day_mode === 'business' ? '営業日' : '暦日'}ベース・即会計除外)`}>
        <ExportCsvButton report="stay_distribution" params={params} />
      </Toolbar>
      <DataBanner />
      <Card dense>
        <PeriodBar />
      </Card>

      {!isValid && <Alert tone="warning">期間の指定が不正です。開始は終了以前の日付にしてください。</Alert>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatTile dense label="P25(短い方から1/4)" value={p ? `${yen(p.p25)} 分` : '—'} />
        <StatTile dense label="中央値(P50)" value={p ? `${yen(p.p50)} 分` : '—'} sub={d ? `平均 ${yen(d.avg_minutes)} 分` : undefined} />
        <StatTile dense label="P75(長い方から1/4)" value={p ? `${yen(p.p75)} 分` : '—'} />
        <StatTile dense label="P90" value={p ? `${yen(p.p90)} 分` : '—'} sub={d ? `対象 ${yen(d.count)} 組` : undefined} />
      </div>

      <Card
        title="滞在時間の分布"
        dense
        actions={
          <Field label="階級幅" htmlFor="stay-bin" className="flex items-center gap-2 [&>label]:mb-0">
            <Select id="stay-bin" size="sm" className="w-24" value={binMinutes} options={BIN_OPTIONS}
              onChange={(e) => setBinMinutes(e.target.value)} />
          </Field>
        }
      >
        <ChartState query={stayQ} height={300} isEmpty={(q) => !(q?.buckets || []).some((b) => Number(b.count) > 0)} emptyTitle="期間内に滞在時間データがありません">
          <EChart option={option} height={300} />
        </ChartState>
        <p className="mt-2 text-2xs text-muted">
          即会計テーブルと閉店時刻が開店時刻以前の会計は除外。取消し(void/black_cancelled)も除外。
        </p>
      </Card>
    </div>
  );
}
