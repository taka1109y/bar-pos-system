import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { yen } from '../utils/format';
import { api } from '../api';
import { todayJST } from '../utils/tz';
import { Toolbar, Alert } from '../components/ui';
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

  // Phase6-7: 値引き費用(暴落原資)
  const { data: discount } = useQuery({
    queryKey: ['discount-cost', range.start, range.end],
    queryFn: () => api.getDiscountCost(range.start, range.end),
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
    <div className={inline ? 'ui-pad p-4 md:p-6 space-y-4' : 'ui-pad flex-1 overflow-y-auto p-4 md:p-6 space-y-4'}>
      <Toolbar title="売上管理" subtitle="売上・粗利・時間帯・カテゴリを期間で集計" />


      <PeriodPicker start={range.start} end={range.end} onChange={handleRangeChange} />

      {isLoading ? (
        <div className="flex items-center justify-center h-40 text-muted text-sm">読み込み中...</div>
      ) : error ? (
        <Alert tone="danger">売上データの取得に失敗しました。時間をおいて再度お試しください。</Alert>
      ) : (
        <>
          <SummaryCards summary={s} />

          <ComparisonCard comparison={report?.comparison} isSingleDay={report?.is_single_day} />

          {/* iPad横: 時間帯別 + カテゴリ別を2カラム */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <HourlyChart hourly={report?.hourly} />
            <CategoryBreakdown categories={report?.categories} />
          </div>

          {/* 値引き費用 + 支払い方法内訳 を2カラム */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {discount && (
              <div className="bg-surface border border-line rounded-xl p-4 shadow-sm">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-sm font-bold text-heading">値引き費用（暴落原資）</h3>
                  <span className="text-2xl font-bold text-heading tabular-nums">{yen(discount.total)}</span>
                </div>
                <p className="text-xs text-muted">期間内の値引き（約定 &lt; 定価）の合計。{discount.note}</p>
                {discount.cap > 0 && (
                  <div className="mt-4">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-muted">今月累計 {yen(discount.month_total)} / 上限 {yen(discount.cap)}</span>
                      <span className={discount.over_cap ? 'text-amber-700 font-semibold' : 'text-muted'}>到達率 {discount.cap_reach_pct}%</span>
                    </div>
                    <div className="bg-surface-sunken rounded-full h-2">
                      <div className={`h-2 rounded-full transition-all ${discount.over_cap ? 'bg-amber-500' : 'bg-primary-400'}`}
                        style={{ width: `${Math.min(100, discount.cap_reach_pct ?? 0)}%` }} />
                    </div>
                    {discount.over_cap && (
                      <Alert tone="warning" className="mt-3 text-xs">
                        今月の値引き費用が上限（{yen(discount.cap)}）を超過しています（累計 {yen(discount.month_total)}）。暴落の頻度・幅を見直してください。
                      </Alert>
                    )}
                  </div>
                )}
              </div>
            )}

            {breakdown.length > 0 && (
              <div className="bg-surface border border-line rounded-xl p-4 shadow-sm">
                <h3 className="text-sm font-bold text-heading mb-4">支払い方法内訳</h3>
                <div className="space-y-3">
                  {breakdown.map(b => (
                    <div key={b.method} className="flex items-center gap-3">
                      <span className="w-20 text-sm font-medium text-body flex-shrink-0">{b.label}</span>
                      <div className="flex-1 bg-surface-sunken rounded-full h-2.5">
                        <div className="bg-primary-400 h-2.5 rounded-full transition-all" style={{ width: `${(b.revenue / maxBreakdown) * 100}%` }} />
                      </div>
                      <span className="text-xs text-muted w-8 text-right flex-shrink-0">{b.count}件</span>
                      <span className="text-sm font-bold text-heading w-24 text-right flex-shrink-0 tabular-nums">¥{yen(b.revenue)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="チャージ合計" value={`¥${yen(s?.total_charge)}`} accent={s?.total_charge > 0 ? 'text-heading' : 'text-faint'} />
            <StatCard label="割引合計" value={s?.total_discount > 0 ? `−¥${yen(s.total_discount)}` : '¥0'} accent={s?.total_discount > 0 ? 'text-red-500' : 'text-faint'} />
            <StatCard label="金券合計" value={`¥${yen(s?.total_gift_cert)}`} accent={s?.total_gift_cert > 0 ? 'text-emerald-600' : 'text-faint'} />
            <StatCard label="深夜料金合計" value={`¥${yen(s?.total_late_night)}`} accent={s?.total_late_night > 0 ? 'text-amber-600' : 'text-faint'} />
          </div>

          <ItemRanking items={report?.items} />
        </>
      )}
    </div>
  );

  if (inline) return content;

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 fade-in p-4">
      <div className="ui-pad bg-surface rounded-xl w-full max-w-5xl shadow-xl max-h-[92vh] flex flex-col border border-line pop-in">
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <h2 className="text-base font-semibold text-heading">売上レポート</h2>
          <button onClick={onClose} className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-muted hover:text-heading hover:bg-surface-hover transition-colors cursor-pointer" aria-label="閉じる">✕</button>
        </div>
        <div className="overflow-y-auto">{content}</div>
      </div>
    </div>
  );
}
