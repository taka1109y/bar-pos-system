import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Toolbar, Card, Alert, DataTable, Field, Select, StatTile, cn } from '../components/ui';
import PeriodBar from '../components/period/PeriodBar';
import DataBanner from '../components/DataBanner';
import EChart from '../components/charts/EChart';
import ChartState from '../components/charts/ChartState';
import ExportCsvButton from '../components/ExportCsvButton';
import { usePeriod } from '../utils/period';
import { yen, num } from '../utils/format';
import { api } from '../api';
import { PALETTE, baseGrid, catAxis, yenAxis } from '../components/charts/chartTheme';

// タグ・天候別比較。営業日ノート(/inputs/days)で付けたタグ・天候ごとに営業日単位の平均を比較する。
// 既定はタグ別・天候別の一覧(全営業日平均=baseline を比較基準に)。タグを選ぶと
// 「そのタグの日 vs それ以外の日」の with/without 2グループ比較に切り替わる。
// 営業日 = 期間内に会計が1件以上ある営業日。CSV は /api/v1/export/csv?report=tags_compare。

// 増減%表示(ComparePage と同じ流儀)
function DiffPct({ v }) {
  if (v == null || !Number.isFinite(Number(v))) return <span className="text-faint">—</span>;
  const p = Number(v);
  const tone = p > 0 ? 'text-success' : p < 0 ? 'text-danger' : 'text-muted';
  const arrow = p > 0 ? '▲' : p < 0 ? '▼' : '±';
  return <span className={cn('font-medium tabular-nums', tone)}>{arrow} {p > 0 ? '+' : ''}{num(p, 1)}%</span>;
}

const diffPct = (v, base) => (Number(base) > 0 ? ((Number(v) - Number(base)) / Number(base)) * 100 : null);

// 営業日グループの平均売上バー + 全体平均(markLine)の共通 option
function buildBarOption(items, baselineAvg) {
  return {
    animation: false,
    grid: { ...baseGrid, bottom: items.length > 6 ? 56 : 36 },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (ps) => {
        const i = ps?.[0]?.dataIndex ?? 0;
        const r = items[i] || {};
        return [
          `<div style="font-weight:600">${r.name ?? ''}</div>`,
          `平均売上 ¥${yen(r.avg_revenue)} (${yen(r.days)} 営業日)`,
          `平均客数 ${num(r.avg_guest_count, 1)} 人 / 客単価 ¥${yen(r.avg_per_guest)}`,
        ].join('<br/>');
      },
    },
    xAxis: catAxis(items.map((r) => r.name), {
      axisLabel: { rotate: items.length > 6 ? 30 : 0, fontSize: 10, interval: 0 },
    }),
    yAxis: yenAxis(),
    series: [{
      name: '平均売上', type: 'bar',
      data: items.map((r) => Math.round(r.avg_revenue || 0)),
      itemStyle: { color: PALETTE.blue, borderRadius: [3, 3, 0, 0] },
      barMaxWidth: 36,
      ...(Number(baselineAvg) > 0 ? {
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { color: PALETTE.muted, type: 'dashed', width: 2 },
          label: { formatter: '全体平均', position: 'insideEndTop', color: PALETTE.axis, fontSize: 10 },
          data: [{ yAxis: Math.round(baselineAvg) }],
        },
      } : {}),
    }],
  };
}

// 比較表の列(baseline 行は _baseline=true で強調・「基準」表示)
function makeColumns(nameHeader) {
  return [
    {
      key: 'name', header: nameHeader,
      render: (r) => <span className={cn('text-heading', r._baseline ? 'font-semibold' : 'font-medium')}>{r.name}</span>,
    },
    { key: 'days', header: '営業日数', align: 'right', width: 80, render: (r) => <span className="tabular-nums">{yen(r.days)} 日</span> },
    { key: 'avg_revenue', header: '平均売上', align: 'right', render: (r) => <span className="tabular-nums">¥{yen(r.avg_revenue)}</span> },
    { key: 'avg_order_count', header: '平均会計', align: 'right', width: 90, render: (r) => <span className="tabular-nums">{num(r.avg_order_count, 1)} 件</span> },
    { key: 'avg_guest_count', header: '平均客数', align: 'right', width: 90, render: (r) => <span className="tabular-nums">{num(r.avg_guest_count, 1)} 人</span> },
    { key: 'avg_per_guest', header: '客単価', align: 'right', width: 90, render: (r) => <span className="tabular-nums">¥{yen(r.avg_per_guest)}</span> },
    {
      key: 'diff', header: '対全体平均', align: 'right', width: 110,
      render: (r) => (r._baseline ? <span className="text-faint">基準</span> : <DiffPct v={r.diff} />),
    },
  ];
}

export default function TagsComparePage() {
  const { period, isValid } = usePeriod();
  const { start, end, day_mode } = period;
  const [tagCode, setTagCode] = useState('');

  const tagsQ = useQuery({ queryKey: ['v1', 'tags'], queryFn: api.getTags });
  const params = { start, end, day_mode, ...(tagCode ? { tag: tagCode } : {}) };
  const cmpQ = useQuery({
    queryKey: ['v1', 'tags', 'compare', start, end, day_mode, tagCode],
    queryFn: () => api.getTagsCompare(params),
    enabled: isValid,
  });

  const d = cmpQ.data;
  const baseline = d?.baseline;
  const groups = d?.groups; // タグ指定時のみ(with/without)

  const tagOptions = useMemo(() => [
    { value: '', label: '全体(タグ別・天候別)' },
    ...(tagsQ.data?.rows || [])
      .filter((t) => t.is_active !== false || t.used_days > 0)
      .map((t) => ({ value: t.code, label: `${t.name}(${t.used_days}日)` })),
  ], [tagsQ.data]);

  // ---- 既定表示(タグ別・天候別)----
  const tagRows = useMemo(() => {
    if (!baseline) return [];
    const items = (d?.by_tag || []).map((t) => ({ ...t, diff: diffPct(t.avg_revenue, baseline.avg_revenue) }));
    return [...items, { ...baseline, name: '全営業日平均', _baseline: true }];
  }, [d, baseline]);
  const weatherRows = useMemo(() => {
    if (!baseline) return [];
    const items = (d?.by_weather || []).map((w) => ({ ...w, name: w.label, diff: diffPct(w.avg_revenue, baseline.avg_revenue) }));
    return items.length > 0 ? [...items, { ...baseline, name: '全営業日平均', _baseline: true }] : [];
  }, [d, baseline]);

  const tagOption = useMemo(
    () => buildBarOption(tagRows.filter((r) => !r._baseline), baseline?.avg_revenue),
    [tagRows, baseline]
  );
  const weatherOption = useMemo(
    () => buildBarOption(weatherRows.filter((r) => !r._baseline), baseline?.avg_revenue),
    [weatherRows, baseline]
  );

  // ---- タグ指定時(with/without)----
  const withG = groups?.find((g) => g.key === 'with');
  const withoutG = groups?.find((g) => g.key === 'without');
  const groupRows = useMemo(() => (groups || []).map((g) => ({ ...g, name: g.label })), [groups]);
  const groupOption = useMemo(() => buildBarOption(groupRows, null), [groupRows]);
  const groupColumns = useMemo(() => makeColumns('グループ').filter((c) => c.key !== 'diff'), []);

  return (
    <div className="space-y-5">
      <Toolbar title="タグ・天候別比較" subtitle={`営業日タグ・天候ごとの1営業日あたり平均を比較(${day_mode === 'business' ? '営業日' : '暦日'}ベース)`}>
        <ExportCsvButton report="tags_compare" params={params} />
      </Toolbar>
      <DataBanner />
      <Card dense>
        <PeriodBar />
      </Card>

      {!isValid && <Alert tone="warning">期間の指定が不正です。開始は終了以前の日付にしてください。</Alert>}
      {tagsQ.isError && <Alert tone="danger" title="タグ一覧を取得できません">{tagsQ.error?.message}</Alert>}

      <Card dense>
        <div className="flex flex-wrap items-end gap-4">
          <Field label="比較するタグ" htmlFor="cmp-tag" hint="タグを選ぶと「そのタグの日 vs それ以外の日」の比較に切り替わります">
            <Select id="cmp-tag" className="w-64" value={tagCode} options={tagOptions}
              onChange={(e) => setTagCode(e.target.value)} />
          </Field>
        </div>
      </Card>

      {tagCode ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatTile dense label={withG ? `「${withG.label}」の日` : 'タグあり'} value={withG ? `¥${yen(withG.avg_revenue)}` : '—'} sub={withG ? `平均売上(${yen(withG.days)} 営業日)` : undefined} />
            <StatTile dense label="それ以外の日" value={withoutG ? `¥${yen(withoutG.avg_revenue)}` : '—'} sub={withoutG ? `平均売上(${yen(withoutG.days)} 営業日)` : undefined} />
            <StatTile
              dense
              label="平均売上の差"
              value={withG && withoutG && Number(withoutG.avg_revenue) > 0
                ? `${diffPct(withG.avg_revenue, withoutG.avg_revenue) > 0 ? '+' : ''}${num(diffPct(withG.avg_revenue, withoutG.avg_revenue), 1)}%`
                : '—'}
              deltaTone={withG && withoutG ? (Number(withG.avg_revenue) >= Number(withoutG.avg_revenue) ? 'up' : 'down') : 'neutral'}
              sub="タグあり vs それ以外"
            />
            <StatTile dense label="客単価(タグあり)" value={withG ? `¥${yen(withG.avg_per_guest)}` : '—'} sub={withoutG ? `それ以外 ¥${yen(withoutG.avg_per_guest)}` : undefined} />
          </div>

          <Card title={`「${d?.tag?.name ?? tagCode}」の日 vs それ以外の日`} dense>
            <ChartState query={cmpQ} height={260} isEmpty={() => groupRows.length === 0} emptyTitle="期間内に営業日データがありません">
              <EChart option={groupOption} height={260} />
            </ChartState>
          </Card>

          <Card title="グループ別の明細" padded={false}>
            <ChartState query={cmpQ} height={140} isEmpty={() => groupRows.length === 0} emptyTitle="期間内に営業日データがありません">
              <DataTable columns={groupColumns} rows={groupRows} rowKey={(r) => r.key} className="border-0 rounded-none" />
            </ChartState>
          </Card>
        </>
      ) : (
        <>
          <Card title="タグ別(1営業日あたり平均)" dense>
            <ChartState
              query={cmpQ}
              height={260}
              isEmpty={(q) => !(q?.by_tag || []).length}
              emptyTitle="期間内にタグの付いた営業日がありません"
            >
              <EChart option={tagOption} height={260} />
              <div className="mt-3 -mx-3 -mb-3">
                <DataTable columns={makeColumns('タグ')} rows={tagRows} rowKey={(r) => (r._baseline ? 'baseline' : r.tag_id)} className="border-0 rounded-none border-t border-line" />
              </div>
            </ChartState>
            <p className="mt-2 text-2xs text-muted">タグは「営業日ノート」(/inputs/days)で営業日に付けられます。</p>
          </Card>

          <Card title="天候別(1営業日あたり平均)" dense>
            <ChartState
              query={cmpQ}
              height={260}
              isEmpty={(q) => !(q?.by_weather || []).length}
              emptyTitle="期間内に天候の入力された営業日がありません"
            >
              <EChart option={weatherOption} height={260} />
              <div className="mt-3 -mx-3 -mb-3">
                <DataTable columns={makeColumns('天候')} rows={weatherRows} rowKey={(r) => (r._baseline ? 'baseline' : r.weather)} className="border-0 rounded-none border-t border-line" />
              </div>
            </ChartState>
            <p className="mt-2 text-2xs text-muted">天候は「営業日ノート」(/inputs/days)で営業日ごとに入力します。</p>
          </Card>
        </>
      )}

      <p className="text-2xs text-muted">
        営業日 = 期間内に会計が1件以上ある営業日。平均は営業日単位の平均(客単価のみ 合計売上 ÷ 合計客数)。
        取消し(void/black_cancelled)は除外。
      </p>
    </div>
  );
}
