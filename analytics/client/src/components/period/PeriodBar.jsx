import { Field, Input, Select, Segmented, FilterBar } from '../ui';
import { usePeriod, PRESETS, DAY_MODES, GRANULARITIES, COMPARES } from '../../utils/period';

// 期間バー。開始/終了(date) × プリセット × 営業日/暦日 × 粒度 × 比較。
// 状態は usePeriod()(URL クエリ)と双方向。プリセット選択は start/end を書き換えるだけで
// セレクト自体は保持しない(手動で日付を変えた時点でプリセットとの対応が崩れるため)。
export default function PeriodBar({ className }) {
  const { period, setPeriod, applyPreset, isValid, days } = usePeriod();
  const { start, end, day_mode, granularity, compare } = period;

  return (
    <FilterBar className={className}>
      <Field label="開始" htmlFor="period-start" className="w-40" error={!isValid ? '開始は終了以前にしてください' : undefined}>
        <Input id="period-start" type="date" value={start} invalid={!isValid} max={end || undefined}
          onChange={(e) => e.target.value && setPeriod({ start: e.target.value })} />
      </Field>
      <Field label="終了" htmlFor="period-end" className="w-40">
        <Input id="period-end" type="date" value={end} invalid={!isValid}
          onChange={(e) => e.target.value && setPeriod({ end: e.target.value })} />
      </Field>
      <Field label="プリセット" htmlFor="period-preset">
        <Select id="period-preset" value="" options={PRESETS} className="w-36"
          onChange={(e) => e.target.value && applyPreset(e.target.value)} />
      </Field>
      <Field label="日付の基準">
        <Segmented options={DAY_MODES} value={day_mode} onChange={(v) => setPeriod({ day_mode: v })} />
      </Field>
      <Field label="粒度" htmlFor="period-granularity">
        <Select id="period-granularity" value={granularity} options={GRANULARITIES} className="w-24"
          onChange={(e) => setPeriod({ granularity: e.target.value })} />
      </Field>
      <Field label="比較" htmlFor="period-compare">
        <Select id="period-compare" value={compare} options={COMPARES} className="w-36"
          onChange={(e) => setPeriod({ compare: e.target.value })} />
      </Field>
      <div className="leading-normal h-9 flex items-center text-xs text-muted tabular-nums">
        {isValid ? `${days} 日間` : ''}
      </div>
    </FilterBar>
  );
}
