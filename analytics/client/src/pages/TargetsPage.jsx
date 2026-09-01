import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { Toolbar, Card, Alert, DataTable, Badge, Button, Input, cn } from '../components/ui';
import MonthBar from '../components/period/MonthBar';
import DataBanner from '../components/DataBanner';
import ChartState from '../components/charts/ChartState';
import ExportCsvButton from '../components/ExportCsvButton';
import { todayJST } from '../utils/tz';
import { yen, num } from '../utils/format';
import { api } from '../api';

// 目標管理。上段は選択月の進捗(目標/実績/達成率/着地予測/残り日割)、下段は年度の月次目標グリッド。
// 実績は営業日基準の月集計(売上サマリと同定義)。目標は analyticsdb の targets へ
// セルの blur で PUT(upsert)、空欄にすると DELETE する。
// CSV は /api/v1/export/csv?report=targets_progress。

const MONTH_RE = /^\d{4}-\d{2}$/;

// 指標定義(サーバの METRICS と同値)。unit はグリッドの行ラベルに使う
const METRIC_ROWS = [
  { key: 'revenue', label: '売上', unit: '円' },
  { key: 'gross_profit', label: '粗利', unit: '円' },
  { key: 'guest_count', label: '客数', unit: '人' },
  { key: 'order_count', label: '会計件数', unit: '件' },
];

const isMoney = (m) => m === 'revenue' || m === 'gross_profit';
const fmtMetric = (m, v) => (isMoney(m) ? `¥${yen(v)}` : m === 'guest_count' ? `${yen(v)} 人` : `${yen(v)} 件`);

// 達成率のプログレスバー(100%超は success 色で満杯表示)
function AchievementBar({ pct }) {
  if (pct == null) return <span className="text-faint">目標未設定</span>;
  const p = Number(pct);
  const width = Math.max(0, Math.min(p, 100));
  return (
    <div className="flex items-center gap-2 min-w-[150px]">
      <div
        className="flex-1 h-2 rounded-full bg-surface-sunken overflow-hidden"
        role="progressbar"
        aria-valuenow={Math.round(p)}
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <div className={cn('h-2 rounded-full', p >= 100 ? 'bg-success' : 'bg-primary-500')} style={{ width: `${width}%` }} />
      </div>
      <span className={cn('tabular-nums text-xs w-14 text-right', p >= 100 ? 'text-success font-medium' : 'text-body')}>
        {num(p, 1)}%
      </span>
    </div>
  );
}

export default function TargetsPage() {
  const qc = useQueryClient();
  const [month, setMonth] = useState(() => todayJST().slice(0, 7));
  const [year, setYear] = useState(null); // null = サーバの今年度既定
  const [edits, setEdits] = useState({}); // { `${metric}|${period_start}`: 入力中文字列 }
  const [notice, setNotice] = useState(null); // { tone, text }

  const progressQ = useQuery({
    queryKey: ['v1', 'targets', 'progress', month],
    queryFn: () => api.getTargetsProgress({ month }),
    enabled: MONTH_RE.test(month),
  });
  const targetsQ = useQuery({
    queryKey: ['v1', 'targets', 'grid', year],
    queryFn: () => api.getTargets(year ? { year } : {}),
  });

  // 保存/削除の簡易表示は数秒で消す
  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(null), 3000);
    return () => clearTimeout(t);
  }, [notice]);

  const clearEdit = (key) => setEdits((p) => {
    const n = { ...p };
    delete n[key];
    return n;
  });
  const afterChange = (key, text) => {
    clearEdit(key);
    setNotice({ tone: 'success', text });
    qc.invalidateQueries({ queryKey: ['v1', 'targets'] }); // グリッドと進捗の両方を更新
  };

  const saveMut = useMutation({
    mutationFn: ({ period_start, metric, value }) => api.putTarget({ period_type: 'month', period_start, metric, value }),
    onSuccess: (_d, vars) => afterChange(vars.key, '目標を保存しました'),
    onError: (e, vars) => { clearEdit(vars.key); setNotice({ tone: 'danger', text: `保存に失敗しました: ${e.message}` }); },
  });
  const delMut = useMutation({
    mutationFn: ({ period_start, metric }) => api.deleteTarget({ period_type: 'month', period_start, metric }),
    onSuccess: (_d, vars) => afterChange(vars.key, '目標を削除しました'),
    onError: (e, vars) => { clearEdit(vars.key); setNotice({ tone: 'danger', text: `削除に失敗しました: ${e.message}` }); },
  });

  // 年度グリッドの既存値(period_type='month' のみ)
  const valueMap = useMemo(() => {
    const m = new Map();
    for (const r of targetsQ.data?.rows || []) {
      if (r.period_type === 'month') m.set(`${r.metric}|${r.period_start}`, Number(r.value));
    }
    return m;
  }, [targetsQ.data]);

  const fyStart = targetsQ.data?.fiscal_year_start;
  const months = useMemo(() => {
    if (!fyStart) return [];
    return Array.from({ length: 12 }, (_, i) => {
      const d = dayjs(fyStart).add(i, 'month');
      return { period_start: d.format('YYYY-MM-DD'), label: d.format('YYYY年M月'), short: d.format('M月') };
    });
  }, [fyStart]);

  // セルの blur で確定。空欄=削除、数値=upsert、変更なし=何もしない
  const commit = (metric, periodStart) => {
    const key = `${metric}|${periodStart}`;
    if (!(key in edits)) return;
    const raw = String(edits[key]).trim();
    const orig = valueMap.get(key);
    if (raw === '') {
      if (orig != null) delMut.mutate({ period_start: periodStart, metric, key });
      else clearEdit(key);
      return;
    }
    const n = Number(raw.replace(/,/g, ''));
    if (!Number.isFinite(n) || n < 0) {
      clearEdit(key);
      setNotice({ tone: 'danger', text: '目標は0以上の数値で入力してください' });
      return;
    }
    if (orig != null && n === orig) { clearEdit(key); return; }
    saveMut.mutate({ period_start: periodStart, metric, value: n, key });
  };

  // ---- 進捗表 ----
  const progressRows = progressQ.data?.rows || [];
  const PROGRESS_COLUMNS = [
    { key: 'label', header: '指標', width: 100, render: (r) => <span className="text-heading font-medium">{r.label}</span> },
    {
      key: 'target', header: '目標', align: 'right', width: 120,
      render: (r) => (r.target == null ? <span className="text-faint">未設定</span> : <span className="tabular-nums">{fmtMetric(r.metric, r.target)}</span>),
    },
    { key: 'actual', header: '実績', align: 'right', width: 120, render: (r) => <span className="tabular-nums text-heading">{fmtMetric(r.metric, r.actual)}</span> },
    { key: 'achievement_pct', header: '達成率', width: 200, render: (r) => <AchievementBar pct={r.achievement_pct} /> },
    {
      key: 'forecast', header: '着地予測', align: 'right', width: 120,
      render: (r) => (r.forecast == null ? <span className="text-faint">—</span> : <span className="tabular-nums">{fmtMetric(r.metric, r.forecast)}</span>),
    },
    {
      key: 'required_per_remaining_day', header: '残り日割', align: 'right', width: 130,
      render: (r) => {
        const v = r.required_per_remaining_day;
        if (v == null) return <span className="text-faint">—</span>;
        if (Number(v) <= 0) return <Badge tone="success" size="sm">達成済み</Badge>;
        return <span className="tabular-nums">{isMoney(r.metric) ? `¥${yen(v)}/日` : `${num(v, 1)}/日`}</span>;
      },
    },
  ];

  // ---- 年度グリッド(指標 × 12ヶ月) ----
  const GRID_COLUMNS = [
    {
      key: 'label', header: '指標', width: 110,
      render: (r) => (
        <span className="text-heading font-medium whitespace-nowrap">
          {r.label}<span className="text-muted font-normal">({r.unit})</span>
        </span>
      ),
    },
    ...months.map((m) => ({
      key: m.period_start,
      header: m.short,
      align: 'right',
      render: (r) => {
        const key = `${r.key}|${m.period_start}`;
        const stored = valueMap.get(key);
        const val = edits[key] ?? (stored != null ? String(stored) : '');
        return (
          <Input
            size="sm"
            inputMode="numeric"
            className="w-24 text-right tabular-nums"
            value={val}
            placeholder="—"
            aria-label={`${r.label}の${m.label}目標`}
            onChange={(e) => setEdits((p) => ({ ...p, [key]: e.target.value }))}
            onBlur={() => commit(r.key, m.period_start)}
          />
        );
      },
    })),
  ];

  const elapsed = progressRows[0];
  const displayYear = targetsQ.data?.year;

  return (
    <div className="space-y-5">
      <Toolbar title="目標管理" subtitle="月次目標の進捗と、年度の目標入力(実績は営業日基準の月集計)">
        <ExportCsvButton report="targets_progress" params={{ month }} />
      </Toolbar>
      <DataBanner />

      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}

      <Card
        title="月次進捗"
        padded={false}
        actions={
          <div className="flex items-center gap-3">
            {elapsed && (
              <span className="text-xs text-muted tabular-nums">
                経過 {yen(elapsed.elapsed_days)}/{yen(elapsed.month_days)} 日
              </span>
            )}
            <MonthBar month={month} onChange={setMonth} />
          </div>
        }
      >
        <ChartState query={progressQ} height={180} isEmpty={(d) => !(d?.rows || []).length} emptyTitle="進捗データがありません">
          <DataTable columns={PROGRESS_COLUMNS} rows={progressRows} rowKey={(r) => r.metric} className="border-0 rounded-none" />
        </ChartState>
        <p className="px-3 py-2 text-2xs text-muted border-t border-line">
          着地予測 = 実績 ÷ 経過日数 × 月日数(月末経過後は実績そのまま)。残り日割 = (目標 − 実績) ÷ 残暦日。
          実績は営業日基準・取消し(void/black_cancelled)除外で、売上サマリと同じ定義。
        </p>
      </Card>

      <Card
        title="年度の月次目標"
        padded={false}
        actions={
          <div className="flex items-center gap-1.5">
            <Button variant="secondary" size="sm" iconOnly aria-label="前の年度" disabled={displayYear == null}
              onClick={() => setYear(displayYear - 1)}>
              <svg viewBox="0 0 20 20" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5l-5 5 5 5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </Button>
            <span className="text-sm font-medium text-heading tabular-nums w-24 text-center">
              {displayYear != null ? `${displayYear}年度` : '—'}
            </span>
            <Button variant="secondary" size="sm" iconOnly aria-label="次の年度" disabled={displayYear == null}
              onClick={() => setYear(displayYear + 1)}>
              <svg viewBox="0 0 20 20" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 5l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </Button>
          </div>
        }
      >
        <ChartState query={targetsQ} height={200} isEmpty={() => months.length === 0} emptyTitle="年度情報を取得できません">
          <DataTable columns={GRID_COLUMNS} rows={METRIC_ROWS} rowKey={(r) => r.key} className="border-0 rounded-none" />
        </ChartState>
        <p className="px-3 py-2 text-2xs text-muted border-t border-line">
          {targetsQ.data ? `年度は ${targetsQ.data.fiscal_year_start} 開始(店舗設定の年度開始月)。` : ''}
          セルからフォーカスを外すと保存されます。空欄にすると目標を削除します。
        </p>
      </Card>
    </div>
  );
}
