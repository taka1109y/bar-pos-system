import { useEffect, useMemo } from 'react';
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
import { PALETTE, baseGrid, catAxis, yenAxis, yenShort } from '../components/charts/chartTheme';

// 月次P&L(/pl/statement)。GET /api/v1/pl/statement の rows(バケット別) + totals(合計)を
// ウォーターフォールと「科目 × 期間」表で見る。
//
// サーバ側の定義(routes/pl.js)をそのまま画面の注記に反映している:
//   ・売上・原価(レシピ)・粗利 は売上分析(/sales)と同一定義
//   ・人件費計 = labor_shift(シフトの実働分×時給スナップショット) + labor_other(経費のPL行 labor)
//     include_owner_labor=false ならオーナーのシフトは除外される
//   ・営業利益 = 粗利 −(人件費計 + 仕入・人件費以外の経費)
//     仕入(purchase)はレシピ原価との二重控除になるため営業利益に含めない。
//     代わりに参考行 alt_purchase_based_profit(= 売上 − 実仕入 − 人件費計 − 経費)を併記する
//   ・alloc_method='month_even' の経費は月内の営業日数で日割りし、期間内の営業日分だけ計上
//     (営業日が1日も無い月は暦日で日割り)
//   ・FLコスト = 原価(レシピ) + 人件費計
// 粒度は month / fiscal_year のみ(サーバが 400 を返す)。日・週が選ばれていたら月へ寄せる。
// CSV は /api/v1/export/csv?report=pl_statement。

const PL_GRANULARITIES = ['month', 'fiscal_year'];

// 営業利益の控除対象になる経費行(routes/pl.js の EXPENSE_LINES と同じ並び)
const EXPENSE_LINES = ['rent', 'utilities', 'supplies', 'marketing', 'fees', 'other'];
const PNL_LABELS = {
  purchase: '仕入', labor: '人件費', rent: '家賃', utilities: '水道光熱',
  supplies: '消耗品', marketing: '販促', fees: '手数料', other: 'その他',
};

const fmtYen = (v) => `¥${yen(v)}`;
// 符号付き金額(営業利益・参考行はマイナスになり得るので「¥-500」を避ける)
const fmtSigned = (v) => {
  const n = Math.round(Number(v) || 0);
  return n < 0 ? `-¥${yen(Math.abs(n))}` : `¥${yen(n)}`;
};
const fmtPct = (v) => (v == null ? '—' : `${num(v, 1)}%`);

// 表の行定義。kind は表示形式、tone は行の強調度
const STATEMENT_ROWS = [
  { key: 'revenue',       label: '売上',                    get: (r) => r.revenue,       kind: 'yen',    tone: 'strong' },
  { key: 'cogs_recipe',   label: '原価(レシピ)',            get: (r) => r.cogs_recipe,   kind: 'yen' },
  { key: 'gross_profit',  label: '粗利',                    get: (r) => r.gross_profit,  kind: 'signed', tone: 'strong' },
  { key: 'gross_rate',    label: '粗利率',                  get: (r) => r.gross_profit_rate, kind: 'pct' },
  { key: 'labor_shift',   label: '人件費(シフト)',          get: (r) => r.labor_shift,   kind: 'yen' },
  { key: 'labor_other',   label: '人件費(経費)',            get: (r) => r.labor_other,   kind: 'yen' },
  { key: 'labor_total',   label: '人件費計',                get: (r) => r.labor_total,   kind: 'yen',    tone: 'sub' },
  { key: 'labor_rate',    label: '人件費率',                get: (r) => r.labor_cost_rate, kind: 'pct' },
  ...EXPENSE_LINES.map((line) => ({
    key: `exp_${line}`, label: PNL_LABELS[line], kind: 'yen',
    get: (r) => (r.expenses_by_line || {})[line] || 0,
  })),
  { key: 'exp_total',     label: '経費計(仕入・人件費除く)', get: (r) => r.expenses_total_excl_purchase_labor, kind: 'yen', tone: 'sub' },
  { key: 'op_profit',     label: '営業利益',                get: (r) => r.operating_profit, kind: 'signed', tone: 'strong' },
  { key: 'op_margin',     label: '営業利益率',              get: (r) => r.operating_margin_pct, kind: 'pct' },
  { key: 'fl_cost',       label: 'FLコスト',                get: (r) => r.fl_cost,       kind: 'yen' },
  { key: 'fl_ratio',      label: 'FL比率',                  get: (r) => r.fl_ratio_pct,  kind: 'pct' },
  { key: 'purchase',      label: '参考: 実仕入',            get: (r) => r.purchase_actual, kind: 'yen',  tone: 'ref' },
  { key: 'alt_profit',    label: '参考: 実仕入ベース営業利益', get: (r) => r.alt_purchase_based_profit, kind: 'signed', tone: 'ref' },
];

function cellText(kind, v) {
  if (kind === 'pct') return fmtPct(v);
  if (kind === 'signed') return fmtSigned(v);
  return fmtYen(v);
}

export default function PLStatementPage() {
  const { period, setPeriod, isValid } = usePeriod();
  const { start, end, day_mode, granularity } = period;

  // 粒度は月/年度のみ。日・週が URL に残っていたら月へ寄せる(サーバは 400 を返すため)
  const g = PL_GRANULARITIES.includes(granularity) ? granularity : 'month';
  useEffect(() => {
    if (!PL_GRANULARITIES.includes(granularity)) setPeriod({ granularity: 'month' });
  }, [granularity, setPeriod]);

  const params = { start, end, day_mode, granularity: g };
  const plQ = useQuery({
    queryKey: ['v1', 'pl', 'statement', start, end, day_mode, g],
    queryFn: () => api.getPlStatement(params),
    enabled: isValid,
  });

  const rows = plQ.data?.rows || [];
  const totals = plQ.data?.totals || null;
  const granularityLabel = g === 'fiscal_year' ? '年度' : '月';

  // ウォーターフォール(期間合計)。売上 → −原価 → 粗利(小計) → −人件費計 → −各経費 → 営業利益。
  // 金額0の経費行は落として横幅を稼ぐ(構造行の 売上/粗利/営業利益 は常に出す)。
  const steps = useMemo(() => {
    if (!totals) return [];
    const ex = totals.expenses_by_line || {};
    const out = [
      { label: '売上', kind: 'total', delta: totals.revenue },
      { label: '原価(レシピ)', kind: 'step', delta: -(totals.cogs_recipe || 0) },
      { label: '粗利', kind: 'total', delta: totals.gross_profit },
      { label: '人件費計', kind: 'step', delta: -(totals.labor_total || 0) },
    ];
    for (const line of EXPENSE_LINES) {
      const v = Math.round(Number(ex[line]) || 0);
      if (v !== 0) out.push({ label: PNL_LABELS[line], kind: 'step', delta: -v });
    }
    out.push({ label: '営業利益', kind: 'total', delta: totals.operating_profit });
    return out;
  }, [totals]);

  // stack トリック: 透明な土台 + 見える棒。土台 = min(前, 後)、棒の高さ = |差分|。
  // 小計行(total)は 0 から描くので土台 = min(0, 値)。
  const wf = useMemo(() => {
    let running = 0;
    const base = [];
    const value = [];
    const colors = [];
    const cumulative = [];
    for (const s of steps) {
      const d = Math.round(Number(s.delta) || 0);
      if (s.kind === 'total') {
        base.push(Math.min(0, d));
        value.push(Math.abs(d));
        colors.push(PALETTE.blue);
        running = d;
      } else {
        const next = running + d;
        base.push(Math.min(running, next));
        value.push(Math.abs(d));
        colors.push(d >= 0 ? PALETTE.emerald : PALETTE.amber);
        running = next;
      }
      cumulative.push(running);
    }
    return { base, value, colors, cumulative };
  }, [steps]);

  const wfOption = useMemo(() => ({
    animation: false,
    grid: { ...baseGrid, top: 24, bottom: 44 },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (ps) => {
        const i = ps?.[0]?.dataIndex ?? 0;
        const s = steps[i];
        if (!s) return '';
        const d = Math.round(Number(s.delta) || 0);
        return [
          `<div style="font-weight:600">${s.label}</div>`,
          s.kind === 'total' ? `金額 ${fmtSigned(d)}` : `増減 ${d >= 0 ? '+' : '−'}¥${yen(Math.abs(d))}`,
          `残り ${fmtSigned(wf.cumulative[i])}`,
        ].join('<br/>');
      },
    },
    xAxis: catAxis(steps.map((s) => s.label), { axisLabel: { interval: 0, fontSize: 10, rotate: steps.length > 8 ? 30 : 0 } }),
    yAxis: yenAxis(),
    series: [
      {
        name: '土台', type: 'bar', stack: 'wf', silent: true,
        itemStyle: { color: 'transparent' },
        emphasis: { itemStyle: { color: 'transparent' } },
        data: wf.base,
      },
      {
        name: '金額', type: 'bar', stack: 'wf', barMaxWidth: 40,
        data: wf.value.map((v, i) => ({ value: v, itemStyle: { color: wf.colors[i], borderRadius: [3, 3, 0, 0] } })),
        label: {
          show: true, position: 'top', fontSize: 10, color: PALETTE.axis,
          formatter: (p) => yenShort(Math.round(Number(steps[p.dataIndex]?.delta) || 0)),
        },
      },
    ],
  }), [steps, wf]);

  // 表: 行 = 科目、列 = 各バケット + 合計列
  const columns = useMemo(() => {
    const cols = [{
      key: 'label', header: '科目', width: 190,
      render: (r) => (
        <span className={cn(
          'whitespace-nowrap',
          r.tone === 'strong' ? 'font-semibold text-heading'
            : r.tone === 'sub' ? 'font-medium text-heading'
              : r.tone === 'ref' ? 'text-muted' : 'text-body'
        )}>
          {r.label}
        </span>
      ),
    }];
    rows.forEach((p, i) => {
      cols.push({
        key: `p${i}`, header: p.label, align: 'right', width: 110,
        render: (r) => (
          <span className={cn('tabular-nums whitespace-nowrap', r.tone === 'strong' && 'font-semibold text-heading', r.tone === 'ref' && 'text-muted')}>
            {cellText(r.kind, r[`p${i}`])}
          </span>
        ),
      });
    });
    cols.push({
      key: 'total', header: '合計', align: 'right', width: 120,
      thClassName: 'bg-surface-sunken',
      render: (r) => (
        <span className={cn('tabular-nums whitespace-nowrap font-semibold', r.tone === 'ref' ? 'text-muted' : 'text-heading')}>
          {cellText(r.kind, r.total)}
        </span>
      ),
    });
    return cols;
  }, [rows]);

  const tableRows = useMemo(() => {
    if (!totals) return [];
    return STATEMENT_ROWS.map((def) => {
      const row = { key: def.key, label: def.label, kind: def.kind, tone: def.tone || null };
      rows.forEach((p, i) => { row[`p${i}`] = def.get(p); });
      row.total = def.get(totals);
      return row;
    });
  }, [rows, totals]);

  const hasData = rows.length > 0 && totals != null;

  return (
    <div className="space-y-5">
      <Toolbar
        title="月次P&L"
        subtitle={`売上から営業利益までの${granularityLabel}次損益(${day_mode === 'business' ? '営業日' : '暦日'}ベース)`}
      >
        <ExportCsvButton report="pl_statement" params={params} />
        <PrintButton />
      </Toolbar>
      <DataBanner />
      <Card dense>
        <PeriodBar />
        <p className="mt-2 text-2xs text-muted">
          このページの粒度は「月」と「年度」のみです(日・週を選ぶと月に切り替わります)。
        </p>
      </Card>

      {!isValid && <Alert tone="warning">期間の指定が不正です。開始は終了以前の日付にしてください。</Alert>}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatTile dense label="売上" value={totals ? fmtYen(totals.revenue) : '—'} />
        <StatTile dense label="粗利" value={totals ? fmtSigned(totals.gross_profit) : '—'} sub={totals ? `粗利率 ${fmtPct(totals.gross_profit_rate)}` : undefined} />
        <StatTile dense label="人件費計" value={totals ? fmtYen(totals.labor_total) : '—'} sub={totals ? `人件費率 ${fmtPct(totals.labor_cost_rate)}` : undefined} />
        <StatTile
          dense label="営業利益"
          value={totals ? fmtSigned(totals.operating_profit) : '—'}
          sub={totals ? `営業利益率 ${fmtPct(totals.operating_margin_pct)}` : undefined}
          delta={totals ? (totals.operating_profit >= 0 ? '黒字' : '赤字') : undefined}
          deltaTone={totals ? (totals.operating_profit >= 0 ? 'up' : 'down') : 'neutral'}
        />
        <StatTile dense label="FL比率" value={totals ? fmtPct(totals.fl_ratio_pct) : '—'} sub={totals ? `FLコスト ${fmtYen(totals.fl_cost)}` : undefined} />
      </div>

      <Card title="売上から営業利益まで(期間合計)" dense>
        <ChartState query={plQ} height={340} isEmpty={() => !hasData} emptyTitle="期間内に会計データがありません">
          <EChart option={wfOption} height={340} />
        </ChartState>
        <p className="mt-2 text-2xs text-muted">
          青 = 売上・粗利・営業利益(0からの絶対額)、橙 = 差し引く費用。仕入(実仕入)は原価(レシピ)と二重に引くことになるため、この図と営業利益には含めていません。
        </p>
      </Card>

      <Card title={`科目 × ${granularityLabel}`} padded={false}>
        <ChartState query={plQ} height={240} isEmpty={() => !hasData} emptyTitle="期間内に会計データがありません">
          <DataTable columns={columns} rows={tableRows} rowKey={(r) => r.key} className="border-0 rounded-none" />
        </ChartState>
        <div className="px-3 py-2 text-2xs text-muted border-t border-line space-y-1">
          <p>
            営業利益 = 粗利 −(人件費計 + 仕入・人件費以外の経費)。
            <span className="font-medium text-body">仕入(purchase)は原価(レシピ)と二重控除になるため営業利益に含めません。</span>
            実仕入で見たい場合は参考行「実仕入ベース営業利益」(= 売上 − 実仕入 − 人件費計 − 経費)を使ってください。
          </p>
          <p>
            人件費計 = 人件費(シフト。実働分 × 時給スナップショット。店舗設定の include_owner_labor が false ならオーナーのシフトは除外)
            + 人件費(経費。PL行が「人件費」の経費)。FLコスト = 原価(レシピ) + 人件費計。
          </p>
          <p>
            按分方法が「月割」の経費は、その月の営業日数で日割りし、期間に入る営業日分だけ計上します(営業日が1日も無い月は暦日で日割り)。
            売上・原価(レシピ)・粗利は売上分析と同一定義で、取消し(void/black_cancelled)は除外しています。
          </p>
        </div>
      </Card>
    </div>
  );
}
