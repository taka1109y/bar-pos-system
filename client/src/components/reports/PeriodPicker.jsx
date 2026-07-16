import { TZ } from '../../utils/tz';

const inp = 'h-9 px-3 text-sm border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 caret-primary-500 transition-colors';

const fmt = (d) => d.toLocaleDateString('sv-SE', { timeZone: TZ });

// JSTの「今日」を Date として得る（ブラウザのTZに依存させない）
function todayInTZ() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: TZ }));
}

function shift(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// 週は月曜始まり
function startOfWeek(date) {
  const day = date.getDay();
  return shift(date, day === 0 ? -6 : 1 - day);
}

function startOfMonth(date) {
  const d = new Date(date);
  d.setDate(1);
  return d;
}

// クイック選択。終了日は常に今日（未来日を集計対象にしない）
function presets() {
  const t = todayInTZ();
  return [
    { id: 'today', label: '今日', start: fmt(t),               end: fmt(t) },
    { id: 'week',  label: '今週', start: fmt(startOfWeek(t)),  end: fmt(t) },
    { id: 'month', label: '今月', start: fmt(startOfMonth(t)), end: fmt(t) },
  ];
}

export default function PeriodPicker({ start, end, onChange }) {
  const options = presets();
  const active = options.find(p => p.start === start && p.end === end);

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
      <div className="flex flex-wrap items-end gap-4">
        <div className="leading-normal">
          <label htmlFor="report-start" className="block text-xs font-medium text-slate-500 mb-1">開始日</label>
          <input
            id="report-start"
            type="date"
            value={start}
            max={end}
            onChange={(e) => onChange(e.target.value, end)}
            className={inp}
          />
        </div>
        <div className="leading-normal">
          <label htmlFor="report-end" className="block text-xs font-medium text-slate-500 mb-1">終了日</label>
          <input
            id="report-end"
            type="date"
            value={end}
            min={start}
            onChange={(e) => onChange(start, e.target.value)}
            className={inp}
          />
        </div>
        <div className="leading-normal">
          <span className="block text-xs font-medium text-slate-500 mb-1">クイック選択</span>
          <div className="flex gap-2">
            {options.map(p => (
              <button
                key={p.id}
                type="button"
                onClick={() => onChange(p.start, p.end)}
                aria-pressed={active?.id === p.id}
                className={`h-9 px-3 text-sm font-medium rounded-lg border transition-colors cursor-pointer ${
                  active?.id === p.id
                    ? 'bg-primary-50 border-primary-200 text-primary-500'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-gray-50'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
