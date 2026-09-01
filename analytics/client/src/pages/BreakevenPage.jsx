import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Toolbar, Card, Alert, DataTable, Segmented, StatTile, Field, cn } from '../components/ui';
import MonthBar from '../components/period/MonthBar';
import DataBanner from '../components/DataBanner';
import EChart from '../components/charts/EChart';
import ChartState from '../components/charts/ChartState';
import ExportCsvButton from '../components/ExportCsvButton';
import { usePeriod, DAY_MODES } from '../utils/period';
import { todayJST } from '../utils/tz';
import { yen, num } from '../utils/format';
import { api } from '../api';
import { useToastStore } from '../store/useToastStore';
import { PALETTE, baseGrid, yenAxis, yenShort, legend } from '../components/charts/chartTheme';

// 損益分岐点(/pl/breakeven)。GET /api/v1/pl/breakeven?month=YYYY-MM&day_mode。
//
// サーバ側の定義(routes/pl.js)をそのまま画面の注記に反映している:
//   ・固定費 = cost_type=fixed の経費(仕入・人件費行を除く) +(人件費を固定費扱いする設定なら人件費計)
//   ・変動費 = 原価(レシピ) + cost_type=variable の経費(同上) +(固定費扱いしないなら人件費計)
//   ・仕入(purchase)は原価(レシピ)と二重になるため、固定費にも変動費にも入れない(除外額を内訳に表示)
//   ・人件費計は二重計上を避けるため cost_type ではなく store_settings.labor_is_fixed_for_bep で
//     固定費 / 変動費 のどちらか片方にだけ入る(このページのトグルで切り替える)
//   ・BEP売上 = 固定費 ÷ (1 − 変動費率)。変動費率 ≧ 1 のときは算出不能(null)
//   ・remaining_open_days_est = 残暦日 ×(経過営業日 ÷ 経過暦日)の概算
// CSV は /api/v1/export/csv?report=pl_breakeven。

const MONTH_RE = /^\d{4}-\d{2}$/;

const PNL_LABELS = {
  purchase: '仕入', labor: '人件費', rent: '家賃', utilities: '水道光熱',
  supplies: '消耗品', marketing: '販促', fees: '手数料', other: 'その他',
};

const LABOR_MODES = [
  { value: 'fixed', label: '固定費' },
  { value: 'variable', label: '変動費' },
];

const fmtYen = (v) => `¥${yen(v)}`;
const fmtSigned = (v) => {
  const n = Math.round(Number(v) || 0);
  return n < 0 ? `-¥${yen(Math.abs(n))}` : `¥${yen(n)}`;
};
const fmtPct1 = (v) => (v == null ? '—' : `${num(v, 1)}%`);
// variable_cost_rate は 0〜1 の比率(小数第4位まで)で返るのでパーセント表記に直す
const fmtRatePct = (v) => (v == null ? '—' : `${num(Number(v) * 100, 1)}%`);

export default function BreakevenPage() {
  const qc = useQueryClient();
  const push = useToastStore((s) => s.push);
  const { period, setPeriod } = usePeriod();
  const day_mode = period.day_mode;
  const [month, setMonth] = useState(() => todayJST().slice(0, 7));

  const monthValid = MONTH_RE.test(month);
  const params = { month, day_mode };
  const bepQ = useQuery({
    queryKey: ['v1', 'pl', 'breakeven', month, day_mode],
    queryFn: () => api.getPlBreakeven(params),
    enabled: monthValid,
  });

  const d = bepQ.data || null;
  const laborIsFixed = d ? d.labor_is_fixed_for_bep === true : null;

  // 人件費の扱いは store_settings(全ページ共通の設定)なので、PATCH 後は損益系を再取得する
  const laborModeM = useMutation({
    mutationFn: (mode) => api.patchSettings({ labor_is_fixed_for_bep: mode === 'fixed' }),
    onSuccess: (_res, mode) => {
      push(`人件費を${mode === 'fixed' ? '固定費' : '変動費'}として扱う設定に変更しました`, 'success');
      qc.invalidateQueries({ queryKey: ['v1', 'pl'] });
      qc.invalidateQueries({ queryKey: ['v1', 'settings'] });
    },
    onError: (e) => push(`設定を保存できません: ${e.message}`, 'danger'),
  });

  // BEP図: x = 売上(0〜max)、固定費線・総費用線・売上線(45度)・交点マーカー。
  // 変動費率が取れない(売上0)/1以上(いくら売っても赤字)のときは図を出さない。
  const chart = useMemo(() => {
    if (!d || d.bep_revenue == null || d.variable_cost_rate == null) return null;
    const fixed = Number(d.fixed_costs) || 0;
    const vRate = Number(d.variable_cost_rate) || 0;
    const bep = Number(d.bep_revenue) || 0;
    const actual = Number(d.actual_revenue) || 0;
    const maxX = Math.max(bep, actual, 1) * 1.35;
    return { fixed, vRate, bep, actual, maxX };
  }, [d]);

  const bepOption = useMemo(() => {
    if (!chart) return {};
    const { fixed, vRate, bep, actual, maxX } = chart;
    return {
      animation: false,
      grid: { ...baseGrid, left: 60, top: 30, bottom: 44 },
      legend: legend(),
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'line' },
        formatter: (ps) => {
          const x = Math.round(Number(ps?.[0]?.axisValue ?? ps?.[0]?.value?.[0]) || 0);
          const cost = fixed + vRate * x;
          return [
            `<div style="font-weight:600">売上 ¥${yen(x)}</div>`,
            `総費用 ¥${yen(cost)}(固定費 ¥${yen(fixed)} + 変動費 ¥${yen(vRate * x)})`,
            `損益 ${fmtSigned(x - cost)}`,
          ].join('<br/>');
        },
      },
      xAxis: {
        type: 'value', min: 0, max: Math.round(maxX),
        name: '売上', nameLocation: 'middle', nameGap: 28,
        nameTextStyle: { color: PALETTE.axis, fontSize: 11 },
        axisLabel: { color: PALETTE.axis, formatter: yenShort },
        splitLine: { lineStyle: { color: PALETTE.grid } },
      },
      yAxis: yenAxis({ name: '金額', nameTextStyle: { color: PALETTE.axis, fontSize: 11 } }),
      series: [
        {
          name: '売上', type: 'line', showSymbol: false,
          data: [[0, 0], [maxX, maxX]],
          lineStyle: { color: PALETTE.blue, width: 2 },
          itemStyle: { color: PALETTE.blue },
          markLine: {
            silent: true, symbol: 'none',
            lineStyle: { type: 'dashed', color: PALETTE.muted },
            label: { color: PALETTE.axis, fontSize: 10, formatter: () => `実績 ¥${yen(actual)}` },
            data: [{ xAxis: actual }],
          },
        },
        {
          name: '総費用', type: 'line', showSymbol: false,
          data: [[0, fixed], [maxX, fixed + vRate * maxX]],
          lineStyle: { color: PALETTE.amber, width: 2 },
          itemStyle: { color: PALETTE.amber },
        },
        {
          name: '固定費', type: 'line', showSymbol: false,
          data: [[0, fixed], [maxX, fixed]],
          lineStyle: { color: PALETTE.muted, width: 2, type: 'dashed' },
          itemStyle: { color: PALETTE.muted },
        },
        {
          name: '損益分岐点', type: 'scatter', symbolSize: 13,
          data: [[bep, bep]],
          itemStyle: { color: PALETTE.emerald },
          label: {
            show: true, position: 'right', fontSize: 10, color: PALETTE.axis,
            formatter: () => `BEP ¥${yen(bep)}`,
          },
        },
      ],
    };
  }, [chart]);

  // 内訳表(固定費 / 変動費)
  const detailRows = useMemo(() => {
    if (!d?.detail) return [];
    const f = d.detail.fixed_detail || {};
    const v = d.detail.variable_detail || {};
    const out = [];
    out.push({ key: 'f-head', group: '固定費', label: '経費(固定費に分類した科目)', amount: f.expenses_fixed || 0 });
    for (const [line, amount] of Object.entries(f.by_line || {})) {
      out.push({ key: `f-${line}`, group: '固定費', label: `　${PNL_LABELS[line] || line}`, amount, sub: true });
    }
    out.push({ key: 'f-labor', group: '固定費', label: '人件費計', amount: f.labor_total || 0 });
    out.push({ key: 'f-total', group: '固定費', label: '固定費 合計', amount: d.fixed_costs || 0, total: true });
    out.push({ key: 'v-cogs', group: '変動費', label: '原価(レシピ)', amount: v.cogs_recipe || 0 });
    out.push({ key: 'v-head', group: '変動費', label: '経費(変動費に分類した科目)', amount: v.expenses_variable || 0 });
    for (const [line, amount] of Object.entries(v.by_line || {})) {
      out.push({ key: `v-${line}`, group: '変動費', label: `　${PNL_LABELS[line] || line}`, amount, sub: true });
    }
    out.push({ key: 'v-labor', group: '変動費', label: '人件費計', amount: v.labor_total || 0 });
    out.push({
      key: 'v-total', group: '変動費', label: '変動費 合計',
      amount: (v.cogs_recipe || 0) + (v.expenses_variable || 0) + (v.labor_total || 0), total: true,
    });
    out.push({ key: 'x-purchase', group: '除外', label: '実仕入(原価と二重になるため除外)', amount: v.excluded_purchase || 0, excluded: true });
    return out;
  }, [d]);

  const DETAIL_COLUMNS = [
    {
      key: 'group', header: '区分', width: 80,
      render: (r) => <span className={cn('text-2xs', r.excluded ? 'text-faint' : 'text-muted')}>{r.group}</span>,
    },
    {
      key: 'label', header: '項目',
      render: (r) => (
        <span className={cn('whitespace-pre', r.total && 'font-semibold text-heading', r.sub && 'text-muted', r.excluded && 'text-faint')}>
          {r.label}
        </span>
      ),
    },
    {
      key: 'amount', header: '金額', align: 'right', width: 130,
      render: (r) => (
        <span className={cn('tabular-nums', r.total && 'font-semibold text-heading', r.sub && 'text-muted', r.excluded && 'text-faint')}>
          {fmtYen(r.amount)}
        </span>
      ),
    },
  ];

  const bepUnavailable = d && d.bep_revenue == null;

  return (
    <div className="space-y-5">
      <Toolbar
        title="損益分岐点"
        subtitle={`固定費・変動費から見た月次のBEP(${day_mode === 'business' ? '営業日' : '暦日'}ベース)`}
      >
        <ExportCsvButton report="pl_breakeven" params={params} />
      </Toolbar>
      <DataBanner />

      <Card dense>
        <div className="flex flex-wrap items-end gap-4">
          <Field label="対象月">
            <MonthBar month={month} onChange={setMonth} />
          </Field>
          <Field label="日付の基準">
            <Segmented options={DAY_MODES} value={day_mode} onChange={(v) => setPeriod({ day_mode: v })} />
          </Field>
          <Field label="人件費の扱い" hint="全ページ共通の店舗設定(labor_is_fixed_for_bep)を切り替えます">
            <Segmented
              options={LABOR_MODES}
              value={laborIsFixed == null ? '' : laborIsFixed ? 'fixed' : 'variable'}
              onChange={(v) => {
                if (laborModeM.isPending) return;
                if (laborIsFixed != null && v === (laborIsFixed ? 'fixed' : 'variable')) return;
                laborModeM.mutate(v);
              }}
            />
          </Field>
          <div className="leading-normal h-9 flex items-center text-xs text-muted tabular-nums">
            {d ? `${d.start} 〜 ${d.end}` : ''}
          </div>
        </div>
      </Card>

      {!monthValid && <Alert tone="warning">月の指定が不正です。YYYY-MM 形式で指定してください。</Alert>}
      {bepUnavailable && (
        <Alert tone="warning" title="損益分岐点を計算できません">
          変動費率が算出できないか 100% 以上です(売上が0、または売上を上げるほど赤字が増える状態)。
          売上・原価(レシピ)・経費の入力状況を確認してください。
        </Alert>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatTile dense label="固定費" value={d ? fmtYen(d.fixed_costs) : '—'} sub={laborIsFixed ? '人件費計を含む' : '人件費計は変動費側'} />
        <StatTile dense label="変動費率" value={d ? fmtRatePct(d.variable_cost_rate) : '—'} sub="売上1円あたりの変動費" />
        <StatTile dense label="損益分岐点売上" value={d?.bep_revenue != null ? fmtYen(d.bep_revenue) : '—'} sub="固定費 ÷ (1 − 変動費率)" />
        <StatTile dense label="実績売上" value={d ? fmtYen(d.actual_revenue) : '—'} sub={d ? `営業日 ${yen(d.open_days)} 日` : undefined} />
        <StatTile
          dense label="達成率"
          value={d?.attainment_pct != null ? fmtPct1(d.attainment_pct) : '—'}
          delta={d?.attainment_pct != null ? (d.attainment_pct >= 100 ? 'BEP超過' : 'BEP未達') : undefined}
          deltaTone={d?.attainment_pct != null ? (d.attainment_pct >= 100 ? 'up' : 'down') : 'neutral'}
          sub="実績売上 ÷ BEP売上"
        />
        <StatTile
          dense label="安全余裕率"
          value={d?.safety_margin_pct != null ? fmtPct1(d.safety_margin_pct) : '—'}
          delta={d?.safety_margin_pct != null ? (d.safety_margin_pct >= 0 ? '余裕あり' : 'BEP割れ') : undefined}
          deltaTone={d?.safety_margin_pct != null ? (d.safety_margin_pct >= 0 ? 'up' : 'down') : 'neutral'}
          sub="(実績 − BEP) ÷ 実績"
        />
        <StatTile
          dense label="残営業日(概算)"
          value={d?.remaining_open_days_est != null ? `${yen(d.remaining_open_days_est)} 日` : '—'}
          sub="残暦日 × これまでの営業日ペース"
        />
        <StatTile
          dense label="残りの必要日商"
          value={d?.required_per_remaining_day != null ? fmtYen(d.required_per_remaining_day) : '—'}
          sub={d?.required_per_remaining_day === 0 ? 'BEP達成済み' : 'BEP到達に必要な1営業日あたり売上'}
        />
      </div>

      <Card title="損益分岐点図" dense>
        <ChartState query={bepQ} height={340} isEmpty={() => !chart} emptyTitle="損益分岐点を計算できるデータがありません">
          <EChart option={bepOption} height={340} />
        </ChartState>
        <p className="mt-2 text-2xs text-muted">
          青 = 売上線(45度)、橙 = 総費用線(固定費 + 変動費率 × 売上)、灰破線 = 固定費、緑の点 = 損益分岐点。
          縦の破線は今月の実績売上です。
        </p>
      </Card>

      <Card title="固定費・変動費の内訳" padded={false}>
        <ChartState query={bepQ} height={200} isEmpty={() => detailRows.length === 0} emptyTitle="内訳を取得できません">
          <DataTable columns={DETAIL_COLUMNS} rows={detailRows} rowKey={(r) => r.key} className="border-0 rounded-none" />
        </ChartState>
        <div className="px-3 py-2 text-2xs text-muted border-t border-line space-y-1">
          <p>
            固定費 = 経費科目の分類が「固定費」のもの(仕入・人件費の行は除く)。変動費 = 原価(レシピ) + 分類が「変動費」の経費。
            <span className="font-medium text-body">仕入(実仕入)は原価(レシピ)と二重になるため、どちらにも入れていません。</span>
          </p>
          <p>
            人件費計(シフト + 経費の人件費行)は二重計上を避けるため、科目ごとの固定費/変動費の分類ではなく、
            上の「人件費の扱い」トグルで固定費・変動費のどちらか片方にだけ入ります。
          </p>
          <p>
            残営業日は「残暦日 ×(経過営業日 ÷ 経過暦日)」の概算です。按分方法が「月割」の経費は月内の営業日数で日割りしています。
          </p>
        </div>
      </Card>
    </div>
  );
}
