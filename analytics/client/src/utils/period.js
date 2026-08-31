// 期間(start/end)・営業日/暦日・粒度・比較 の URL クエリ同期フック。
// 画面遷移やリロードでも選択状態が保たれ、URL を共有すれば同じ表示が再現できる。
//   ?start=YYYY-MM-DD&end=YYYY-MM-DD&day_mode=business|calendar&granularity=day|week|month|year&compare=...
// 既定: 今月1日〜今日(JST) / business / day / ''(比較なし)
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { todayJST } from './tz';

const FMT = 'YYYY-MM-DD';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const DAY_MODES = [
  { value: 'business', label: '営業日' },
  { value: 'calendar', label: '暦日' },
];

export const GRANULARITIES = [
  { value: 'day',   label: '日' },
  { value: 'week',  label: '週' },
  { value: 'month', label: '月' },
  { value: 'year',  label: '年度' },
];

export const COMPARES = [
  { value: '',              label: 'なし' },
  { value: 'prev_period',   label: '前期間' },
  { value: 'prev_week',     label: '前週' },
  { value: 'prev_year_date', label: '前年同日' },
  { value: 'prev_year_dow',  label: '前年同曜日' },
];

export const PRESETS = [
  { value: '',        label: 'プリセット…' },
  { value: 'today',   label: '今日' },
  { value: 'yesterday', label: '昨日' },
  { value: 'this_week', label: '今週' },
  { value: 'last_week', label: '先週' },
  { value: 'this_month', label: '今月' },
  { value: 'last_month', label: '先月' },
  { value: 'last_30',  label: '直近30日' },
  { value: 'last_90',  label: '直近90日' },
];

const VALID = {
  day_mode:    new Set(DAY_MODES.map((o) => o.value)),
  granularity: new Set(GRANULARITIES.map((o) => o.value)),
  compare:     new Set(COMPARES.map((o) => o.value)),
};

// プリセット → {start,end}。weekStartDow は store_settings.week_start_dow(0=日 … 6=土、既定1=月)。
export function presetRange(key, { weekStartDow = 1 } = {}) {
  const t = dayjs(todayJST());
  const offset = (t.day() - weekStartDow + 7) % 7; // 今週の開始日までの日数
  const weekStart = t.subtract(offset, 'day');
  switch (key) {
    case 'today':      return { start: t.format(FMT), end: t.format(FMT) };
    case 'yesterday':  { const y = t.subtract(1, 'day'); return { start: y.format(FMT), end: y.format(FMT) }; }
    case 'this_week':  return { start: weekStart.format(FMT), end: t.format(FMT) };
    case 'last_week':  return { start: weekStart.subtract(7, 'day').format(FMT), end: weekStart.subtract(1, 'day').format(FMT) };
    case 'this_month': return { start: t.startOf('month').format(FMT), end: t.format(FMT) };
    case 'last_month': { const m = t.subtract(1, 'month'); return { start: m.startOf('month').format(FMT), end: m.endOf('month').format(FMT) }; }
    case 'last_30':    return { start: t.subtract(29, 'day').format(FMT), end: t.format(FMT) };
    case 'last_90':    return { start: t.subtract(89, 'day').format(FMT), end: t.format(FMT) };
    default:           return null;
  }
}

export function defaultPeriod() {
  const t = dayjs(todayJST());
  return {
    start: t.startOf('month').format(FMT),
    end: t.format(FMT),
    day_mode: 'business',
    granularity: 'day',
    compare: '',
  };
}

// URL クエリを正規化して period オブジェクトへ。不正値は既定値へフォールバック。
function parse(sp) {
  const d = defaultPeriod();
  const start = sp.get('start');
  const end = sp.get('end');
  const dm = sp.get('day_mode');
  const g = sp.get('granularity');
  const c = sp.get('compare');
  return {
    start: DATE_RE.test(start || '') ? start : d.start,
    end: DATE_RE.test(end || '') ? end : d.end,
    day_mode: VALID.day_mode.has(dm) ? dm : d.day_mode,
    granularity: VALID.granularity.has(g) ? g : d.granularity,
    compare: VALID.compare.has(c ?? '') ? (c ?? '') : d.compare,
  };
}

export function usePeriod() {
  const [sp, setSp] = useSearchParams();
  const period = useMemo(() => parse(sp), [sp]);

  // 部分更新。既定値と同じキーもそのまま書く(URL を見れば状態が分かるようにする)。
  const setPeriod = useCallback((patch) => {
    setSp((prev) => {
      const next = new URLSearchParams(prev);
      const merged = { ...parse(prev), ...patch };
      Object.entries(merged).forEach(([k, v]) => {
        if (v === '' || v == null) next.delete(k); else next.set(k, v);
      });
      return next;
    }, { replace: true });
  }, [setSp]);

  const applyPreset = useCallback((key, opts) => {
    const r = presetRange(key, opts);
    if (r) setPeriod(r);
  }, [setPeriod]);

  const isValid = period.start <= period.end;
  const days = isValid ? dayjs(period.end).diff(dayjs(period.start), 'day') + 1 : 0;

  return { period, setPeriod, applyPreset, isValid, days };
}
