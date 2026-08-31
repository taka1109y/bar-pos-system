import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Toolbar, Card, Alert, DataTable, Badge, Field, Input, Select, StatTile, cn } from '../components/ui';
import PeriodBar from '../components/period/PeriodBar';
import DataBanner from '../components/DataBanner';
import ChartState from '../components/charts/ChartState';
import ExportCsvButton from '../components/ExportCsvButton';
import { usePeriod } from '../utils/period';
import { yen, num } from '../utils/format';
import { api } from '../api';

// 併売分析。同じ会計で一緒に注文された商品ペアを lift 降順で表示する。
//   support    … 全会計のうち両方を含む会計の割合
//   confidence … A を含む会計のうち B も含む割合(A→B)とその逆(B→A)
//   lift       … 偶然の同時購入と比べて何倍一緒に出るか(1=独立、>1.5 で強い併売傾向)
const LIFT_STRONG = 1.5;
const PAIR_LIMIT = 100;

const pctCell = (v) => <span className="tabular-nums">{num(v, 1)}%</span>;

const COLUMNS = [
  {
    key: 'pair', header: 'ペア',
    render: (r) => (
      <span className="text-heading font-medium">
        {r.a_name} <span className="text-muted font-normal">×</span> {r.b_name}
      </span>
    ),
  },
  {
    key: 'pair_orders', header: '同時購入', align: 'right', width: 90,
    render: (r) => <span className="tabular-nums">{yen(r.pair_orders)} 会計</span>,
  },
  { key: 'support_pct', header: 'support', align: 'right', width: 90, render: (r) => pctCell(r.support_pct) },
  { key: 'confidence_ab', header: 'A→B', align: 'right', width: 80, render: (r) => pctCell(r.confidence_ab) },
  { key: 'confidence_ba', header: 'B→A', align: 'right', width: 80, render: (r) => pctCell(r.confidence_ba) },
  {
    key: 'lift', header: 'lift', align: 'right', width: 110,
    render: (r) => {
      const strong = Number(r.lift) > LIFT_STRONG;
      return (
        <span className="inline-flex items-center gap-1.5">
          <span className={cn('tabular-nums', strong && 'font-semibold text-heading')}>{num(r.lift, 2)}</span>
          {strong && <Badge tone="success" size="sm">強</Badge>}
        </span>
      );
    },
  },
];

export default function AffinityPage() {
  const { period, isValid } = usePeriod();
  const { start, end, day_mode } = period;
  const [minPair, setMinPair] = useState('2');
  const [focusId, setFocusId] = useState('');
  const common = { start, end, day_mode };

  const minPairNum = Math.max(1, parseInt(minPair, 10) || 1);
  const affParams = { ...common, min_pair: minPairNum, limit: PAIR_LIMIT, ...(focusId ? { menu_item_id: focusId } : {}) };

  const affQ = useQuery({
    queryKey: ['v1', 'products', 'affinity', start, end, day_mode, minPairNum, focusId],
    queryFn: () => api.getProductsAffinity(affParams),
    enabled: isValid,
  });
  // 絞り込み用の商品候補(期間内に販売された商品のみ)
  const candQ = useQuery({
    queryKey: ['v1', 'products', 'ranking', start, end, day_mode, 'affinity-candidates'],
    queryFn: () => api.getProductsRanking({ ...common, basis: 'quantity' }),
    enabled: isValid,
  });

  const productOptions = [
    { value: '', label: 'すべての商品' },
    ...(candQ.data?.items || []).map((i) => ({ value: String(i.menu_item_id), label: i.name })),
  ];

  const data = affQ.data;
  const pairs = data?.pairs || [];

  return (
    <div className="space-y-5">
      <Toolbar title="併売分析" subtitle={`同じ会計で一緒に注文された商品ペア(${day_mode === 'business' ? '営業日' : '暦日'}ベース)`}>
        <ExportCsvButton report="affinity" params={affParams} />
      </Toolbar>
      <DataBanner />
      <Card dense>
        <PeriodBar />
      </Card>

      {!isValid && <Alert tone="warning">期間の指定が不正です。開始は終了以前の日付にしてください。</Alert>}

      <Card dense>
        <div className="flex flex-wrap items-end gap-4">
          <Field label="最小同時購入回数" htmlFor="affinity-min-pair" hint={`${minPairNum} 会計以上のペアのみ表示`}>
            <Input
              id="affinity-min-pair"
              type="number"
              min={1}
              className="w-28"
              value={minPair}
              onChange={(e) => setMinPair(e.target.value)}
            />
          </Field>
          <Field label="商品で絞り込み" htmlFor="affinity-focus">
            <Select
              id="affinity-focus"
              className="w-64"
              value={focusId}
              options={productOptions}
              onChange={(e) => setFocusId(e.target.value)}
            />
          </Field>
        </div>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatTile dense label="対象会計" value={data ? `${yen(data.total_orders)} 件` : '—'} sub="期間内の会計数(取消し除く)" />
        <StatTile dense label="表示ペア" value={data ? `${yen(pairs.length)} 組` : '—'} sub={`lift 降順・最大 ${PAIR_LIMIT} 組`} />
        <StatTile
          dense
          label={`強い併売(lift>${LIFT_STRONG})`}
          value={data ? `${yen(pairs.filter((p) => Number(p.lift) > LIFT_STRONG).length)} 組` : '—'}
          sub="セット提案・おすすめ候補"
        />
        <StatTile dense label="最高 lift" value={pairs.length > 0 ? num(pairs[0]?.lift, 2) : '—'} sub={pairs.length > 0 ? `${pairs[0]?.a_name} × ${pairs[0]?.b_name}` : undefined} />
      </div>

      <Alert tone="info" title="見方">
        lift が高いほど「一緒に頼まれやすい」組合せです。lift=1 は偶然と同程度(独立)、{LIFT_STRONG} を超えるペアは強い併売傾向があり、
        セット販売やおすすめ表示の候補になります。support は全会計に占める同時購入の割合、A→B は「A を頼んだ会計のうち B も頼んだ割合」です。
      </Alert>

      <Card title="併売ペア" padded={false}>
        <ChartState
          query={affQ}
          height={200}
          isEmpty={(d) => !(d?.pairs || []).length}
          emptyTitle="条件に合う併売ペアがありません"
        >
          <DataTable
            columns={COLUMNS}
            rows={pairs}
            rowKey={(r) => `${r.a_id}-${r.b_id}`}
            className="border-0 rounded-none"
          />
        </ChartState>
      </Card>
    </div>
  );
}
