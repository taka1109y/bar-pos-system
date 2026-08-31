import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { Toolbar, Card, Alert, Badge, Button, Input, Skeleton, cn } from '../components/ui';
import PeriodBar from '../components/period/PeriodBar';
import DataBanner from '../components/DataBanner';
import ExportCsvButton from '../components/ExportCsvButton';
import { usePeriod } from '../utils/period';
import { todayJST } from '../utils/tz';
import { yen, num } from '../utils/format';
import { api } from '../api';
import { DOW_LABELS, yenShort } from '../components/charts/chartTheme';

// 月次カレンダー。セル = 売上の濃淡 + タグ色ドット + 天候絵文字。
// セルをクリックすると右パネルにその営業日の summary(start=end=当日)を表示する。
// is_open/weather/tags は analyticsdb(business_days/tags)由来で、未入力なら表示しない。

const MONTH_RE = /^\d{4}-\d{2}$/;

// 売上の濃淡(逐次・単一色相 primary の明→暗。文字は常に text-heading が読める明るさに留める)
const SHADES = ['#f0f5ff', '#dde8ff', '#c0d4ff', '#95b6ff', '#6492ff'];
function shadeOf(revenue, max) {
  const v = Number(revenue) || 0;
  if (v <= 0 || !(max > 0)) return null;
  const idx = Math.min(SHADES.length - 1, Math.floor((v / max) * SHADES.length));
  return SHADES[idx];
}

const WEATHER_EMOJI = { sunny: '☀️', cloudy: '☁️', rain: '🌧️', heavy_rain: '⛈️', snow: '❄️' };
const WEATHER_LABEL = { sunny: '晴れ', cloudy: '曇り', rain: '雨', heavy_rain: '大雨', snow: '雪' };

// tags.color はセマンティック名(info/success/…)で入る。ドット用に実色へ変換(不明値は neutral)
const TAG_DOT_COLORS = { info: '#2b70ef', success: '#059669', warning: '#b45309', danger: '#dc2626', neutral: '#94a3b8' };
const tagDotColor = (color) => (typeof color === 'string' && color.startsWith('#') ? color : TAG_DOT_COLORS[color] || TAG_DOT_COLORS.neutral);
const TAG_BADGE_TONES = new Set(['info', 'success', 'warning', 'danger', 'neutral']);

export default function CalendarPage() {
  const { period } = usePeriod();
  const { day_mode } = period;
  const [month, setMonth] = useState(() => todayJST().slice(0, 7));
  const [selected, setSelected] = useState(null);

  const monthValid = MONTH_RE.test(month);
  const calQ = useQuery({
    queryKey: ['v1', 'calendar', month, day_mode],
    queryFn: () => api.getSalesCalendar({ month, day_mode }),
    enabled: monthValid,
  });
  const dayQ = useQuery({
    queryKey: ['v1', 'summary', selected, selected, day_mode],
    queryFn: () => api.getSalesSummary({ start: selected, end: selected, day_mode }),
    enabled: !!selected,
  });

  const days = calQ.data?.days || [];
  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);
  const maxRevenue = useMemo(() => Math.max(0, ...days.map((d) => Number(d.revenue) || 0)), [days]);

  // 月のグリッド(日曜起点)。曜日計算は UTC 固定で閲覧端末のTZに依存させない。
  const cells = useMemo(() => {
    if (!monthValid) return [];
    const [y, m] = month.split('-').map(Number);
    const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const list = Array.from({ length: firstDow }, () => null);
    for (let d = 1; d <= daysInMonth; d++) {
      list.push(`${month}-${String(d).padStart(2, '0')}`);
    }
    return list;
  }, [month, monthValid]);

  const moveMonth = (diff) => {
    setSelected(null);
    setMonth(dayjs(`${month}-01`).add(diff, 'month').format('YYYY-MM'));
  };

  const selectedDay = selected ? byDate.get(selected) : null;
  const s = dayQ.data?.summary;

  return (
    <div className="space-y-5">
      <Toolbar title="カレンダー" subtitle={`営業日ごとの売上を月表示(${day_mode === 'business' ? '営業日' : '暦日'}ベース)`}>
        <ExportCsvButton report="calendar" params={{ month, day_mode }} />
      </Toolbar>
      <DataBanner />
      <Card dense>
        <PeriodBar />
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 items-start">
        <Card
          className="xl:col-span-2"
          dense
          title="月間カレンダー"
          actions={
            <div className="flex items-center gap-1.5">
              <Button variant="secondary" size="sm" iconOnly aria-label="前の月" onClick={() => moveMonth(-1)}>
                <svg viewBox="0 0 20 20" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5l-5 5 5 5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </Button>
              <Input
                size="sm"
                type="month"
                value={month}
                aria-label="表示する月"
                className="w-36"
                onChange={(e) => { if (e.target.value) { setSelected(null); setMonth(e.target.value); } }}
              />
              <Button variant="secondary" size="sm" iconOnly aria-label="次の月" onClick={() => moveMonth(1)}>
                <svg viewBox="0 0 20 20" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 5l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </Button>
            </div>
          }
        >
          {calQ.isError ? (
            <Alert tone="danger" title="カレンダーを取得できません">{calQ.error?.message}</Alert>
          ) : calQ.isLoading ? (
            <Skeleton height={420} />
          ) : (
            <>
              <div className="grid grid-cols-7 gap-1.5 mb-1.5">
                {DOW_LABELS.map((d, i) => (
                  <div key={d} className={cn('text-center text-2xs font-semibold', i === 0 ? 'text-danger' : i === 6 ? 'text-primary-600' : 'text-muted')}>
                    {d}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1.5">
                {cells.map((date, i) => {
                  if (!date) return <div key={`blank-${i}`} aria-hidden="true" />;
                  const d = byDate.get(date);
                  const shade = shadeOf(d?.revenue, maxRevenue);
                  const isSelected = selected === date;
                  const closed = d?.is_open === false;
                  return (
                    <button
                      key={date}
                      type="button"
                      onClick={() => setSelected(date)}
                      aria-pressed={isSelected}
                      aria-label={`${date} 売上 ¥${yen(d?.revenue)}`}
                      className={cn(
                        'relative min-h-20 rounded-lg border p-1.5 text-left flex flex-col gap-0.5 transition-colors cursor-pointer',
                        isSelected ? 'border-primary-500 ring-2 ring-primary-500/30' : 'border-line hover:border-line-strong',
                        closed && 'opacity-60'
                      )}
                      style={{ backgroundColor: shade || 'var(--color-surface)' }}
                    >
                      <div className="flex items-start justify-between gap-1">
                        <span className="text-xs font-semibold text-heading tabular-nums">{Number(date.slice(8))}</span>
                        {d?.weather && <span className="text-xs leading-none" title={WEATHER_LABEL[d.weather] || d.weather}>{WEATHER_EMOJI[d.weather] || ''}</span>}
                      </div>
                      {Number(d?.revenue) > 0 ? (
                        <span className="text-2xs font-semibold text-heading tabular-nums">¥{yenShort(d.revenue)}</span>
                      ) : closed ? (
                        <span className="text-2xs text-muted">休</span>
                      ) : null}
                      {(d?.tags || []).length > 0 && (
                        <span className="mt-auto flex items-center gap-1">
                          {d.tags.map((t) => (
                            <span
                              key={t.code}
                              className="w-1.5 h-1.5 rounded-full"
                              style={{ backgroundColor: tagDotColor(t.color) }}
                              title={t.name}
                            />
                          ))}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-2xs text-muted">
                濃い青ほど売上が高い(最大 ¥{yen(maxRevenue)})。ドット = タグ、絵文字 = 天候(未入力日は無表示)。
              </p>
            </>
          )}
        </Card>

        <Card title={selected ? `${selected} の概況` : '日別サマリ'} dense>
          {!selected ? (
            <p className="text-sm text-muted py-8 text-center">カレンダーの日付をクリックすると、その営業日の概況を表示します。</p>
          ) : dayQ.isError ? (
            <Alert tone="danger" title="概況を取得できません">{dayQ.error?.message}</Alert>
          ) : dayQ.isLoading ? (
            <Skeleton height={260} />
          ) : (
            <div className="space-y-3">
              {(selectedDay?.weather || (selectedDay?.tags || []).length > 0 || selectedDay?.is_open === false) && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {selectedDay?.is_open === false && <Badge tone="neutral">休業</Badge>}
                  {selectedDay?.weather && (
                    <Badge tone="neutral">{WEATHER_EMOJI[selectedDay.weather] || ''} {WEATHER_LABEL[selectedDay.weather] || selectedDay.weather}</Badge>
                  )}
                  {(selectedDay?.tags || []).map((t) => (
                    <Badge key={t.code} tone={TAG_BADGE_TONES.has(t.color) ? t.color : 'neutral'} dot>{t.name}</Badge>
                  ))}
                </div>
              )}
              <dl className="text-sm grid grid-cols-[7rem_1fr] gap-y-1.5">
                <dt className="text-muted">売上</dt><dd className="text-heading font-semibold tabular-nums">¥{yen(s?.total_revenue)}</dd>
                <dt className="text-muted">粗利</dt><dd className="text-heading tabular-nums">¥{yen(s?.gross_profit)}({num(s?.gross_profit_rate, 1)}%)</dd>
                <dt className="text-muted">会計件数</dt><dd className="text-heading tabular-nums">{yen(s?.order_count)} 件</dd>
                <dt className="text-muted">客数</dt><dd className="text-heading tabular-nums">{yen(s?.guest_count)} 人</dd>
                <dt className="text-muted">客単価</dt><dd className="text-heading tabular-nums">¥{yen(s?.avg_per_guest)}</dd>
                <dt className="text-muted">平均滞在</dt><dd className="text-heading tabular-nums">{yen(s?.avg_stay_minutes)} 分</dd>
                <dt className="text-muted">チャージ</dt><dd className="text-heading tabular-nums">¥{yen(s?.total_charge)}</dd>
                <dt className="text-muted">割引</dt><dd className="text-heading tabular-nums">¥{yen(s?.total_discount)}</dd>
              </dl>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
