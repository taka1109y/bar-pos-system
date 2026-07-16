import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { yen } from '../utils/format';
import { api } from '../api';
import { todayJST } from '../utils/tz';
import PeriodPicker from '../components/reports/PeriodPicker';
import StatCard from '../components/reports/StatCard';
import SummaryCards from '../components/reports/SummaryCards';
import ComparisonCard from '../components/reports/ComparisonCard';
import HourlyChart from '../components/reports/HourlyChart';
import CategoryBreakdown from '../components/reports/CategoryBreakdown';
import ItemRanking from '../components/reports/ItemRanking';

export default function ReportsPage({ onClose, inline = false }) {
  const today = todayJST();
  const [range, setRange] = useState({ start: today, end: today });

  const { data: report, isLoading, error } = useQuery({
    queryKey: ['report-analytics', range.start, range.end],
    queryFn: () => api.getAnalytics(range.start, range.end),
    staleTime: 60_000,
  });

  // 開始日を終了日より後にされたら範囲を潰す（サーバの400を待たずに整合させる）
  const handleRangeChange = (start, end) => {
    setRange(start > end ? { start, end: start } : { start, end });
  };

  const breakdown = (report?.payment_breakdown ?? []).filter(b => b.count > 0);
  const maxBreakdown = Math.max(...breakdown.map(b => b.revenue), 1);
  const s = report?.summary;

  const content = (
    <div className={inline ? 'p-8 max-w-5xl mx-auto space-y-6' : 'flex-1 overflow-y-auto px-8 py-12 space-y-6'}>
      {!inline && (
        <div className="mb-2">
          <h1 className="text-3xl font-bold text-slate-900">売上管理</h1>
          <p className="text-base text-body leading-relaxed mt-2">売上・粗利・時間帯・カテゴリを期間で集計します</p>
        </div>
      )}

      <PeriodPicker start={range.start} end={range.end} onChange={handleRangeChange} />

      {isLoading ? (
        <div className="flex items-center justify-center h-40 text-slate-400 text-sm">
          読み込み中...
        </div>
      ) : error ? (
        <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 text-red-800 rounded-lg">
          <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <p className="text-sm">売上データの取得に失敗しました。時間をおいて再度お試しください。</p>
        </div>
      ) : (
        <>
          <SummaryCards summary={s} />

          <ComparisonCard comparison={report?.comparison} isSingleDay={report?.is_single_day} />

          <HourlyChart hourly={report?.hourly} />

          <CategoryBreakdown categories={report?.categories} />

          {breakdown.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
              <h3 className="text-sm font-bold text-slate-700 mb-5">支払い方法内訳</h3>
              <div className="space-y-4">
                {breakdown.map(b => (
                  <div key={b.method} className="flex items-center gap-3">
                    <span className="w-20 text-sm font-medium text-slate-700 flex-shrink-0">{b.label}</span>
                    <div className="flex-1 bg-slate-100 rounded-full h-2.5">
                      <div
                        className="bg-primary-400 h-2.5 rounded-full transition-all"
                        style={{ width: `${(b.revenue / maxBreakdown) * 100}%` }}
                      />
                    </div>
                    <span className="text-xs text-slate-400 w-8 text-right flex-shrink-0">{b.count}件</span>
                    <span className="text-sm font-bold text-slate-900 w-24 text-right flex-shrink-0 tabular-nums">
                      ¥{yen(b.revenue)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-4 gap-4">
            <StatCard
              label="チャージ合計"
              value={`¥${yen(s?.total_charge)}`}
              accent={s?.total_charge > 0 ? 'text-slate-900' : 'text-slate-400'}
            />
            <StatCard
              label="割引合計"
              value={s?.total_discount > 0 ? `−¥${yen(s.total_discount)}` : '¥0'}
              accent={s?.total_discount > 0 ? 'text-red-500' : 'text-slate-400'}
            />
            <StatCard
              label="金券合計"
              value={`¥${yen(s?.total_gift_cert)}`}
              accent={s?.total_gift_cert > 0 ? 'text-emerald-600' : 'text-slate-400'}
            />
            <StatCard
              label="深夜料金合計"
              value={`¥${yen(s?.total_late_night)}`}
              accent={s?.total_late_night > 0 ? 'text-amber-600' : 'text-slate-400'}
            />
          </div>

          <ItemRanking items={report?.items} />
        </>
      )}
    </div>
  );

  if (inline) return content;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 fade-in">
      <div className="bg-white rounded-xl p-6 w-full max-w-5xl mx-4 shadow-xl max-h-[90vh] flex flex-col border border-slate-200 pop-in">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-slate-900">売上レポート</h2>
          <button
            onClick={onClose}
            className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            aria-label="閉じる"
          >
            ✕
          </button>
        </div>
        {content}
      </div>
    </div>
  );
}
