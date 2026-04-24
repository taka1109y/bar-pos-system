import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';

const inp = 'w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 caret-primary-500 transition-colors';
const lbl = 'block text-xs font-semibold text-slate-500 mb-1.5';

function StatCard({ label, value, sub, accent }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">{label}</p>
      <p className={`text-2xl font-black leading-none ${accent ?? 'text-slate-900'}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-1.5">{sub}</p>}
    </div>
  );
}

export default function ReportsPage({ onClose, inline = false }) {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  const [date, setDate] = useState(today);

  const { data: report, isLoading } = useQuery({
    queryKey: ['report-daily', date],
    queryFn: () => api.getDailyReport(date),
  });

  const topItems   = report?.items?.slice(0, 10) || [];
  const maxRevenue = topItems[0]?.revenue || 1;

  const breakdown    = report?.payment_breakdown ?? [];
  const maxBreakdown = Math.max(...breakdown.map(b => b.revenue), 1);

  const content = (
    <div className={inline ? 'p-8 max-w-3xl mx-auto space-y-6' : 'flex-1 overflow-y-auto px-8 py-12 space-y-6'}>
      {!inline && (
        <div className="mb-2">
          <h1 className="text-3xl font-bold text-slate-900">売上管理</h1>
          <p className="text-base text-body leading-relaxed mt-2">日次の売上データを集計・確認できます</p>
        </div>
      )}
      {/* 日付選択 */}
      <div className="flex items-center gap-3">
        <label className={lbl}>集計日</label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className={inp}
          style={{ width: 'auto' }}
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-40 text-slate-400 text-sm">
          読み込み中...
        </div>
      ) : (
        <>
          {/* サマリーカード（上段） */}
          <div className="grid grid-cols-3 gap-4">
            <StatCard label="総売上" value={`¥${Math.floor(report?.total_revenue ?? 0).toLocaleString()}`} />
            <StatCard label="会計件数" value={`${report?.order_count ?? 0}件`} />
            <StatCard label="平均単価" value={`¥${Math.floor(report?.avg_order_value ?? 0).toLocaleString()}`} />
          </div>

          {/* サマリーカード（下段: 割引・金券・深夜） */}
          <div className="grid grid-cols-3 gap-4">
            <StatCard
              label="割引合計"
              value={report?.total_discount > 0 ? `−¥${Math.floor(report.total_discount).toLocaleString()}` : '¥0'}
              accent={report?.total_discount > 0 ? 'text-red-500' : 'text-slate-400'}
            />
            <StatCard
              label="金券合計"
              value={report?.total_gift_cert > 0 ? `¥${Math.floor(report.total_gift_cert).toLocaleString()}` : '¥0'}
              accent={report?.total_gift_cert > 0 ? 'text-emerald-600' : 'text-slate-400'}
            />
            <StatCard
              label="深夜料金合計"
              value={report?.total_late_night > 0 ? `¥${Math.floor(report.total_late_night).toLocaleString()}` : '¥0'}
              accent={report?.total_late_night > 0 ? 'text-amber-600' : 'text-slate-400'}
            />
          </div>

          {/* 支払い方法内訳 */}
          {(report?.order_count ?? 0) > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
              <h3 className="text-sm font-bold text-slate-700 mb-5">支払い方法内訳</h3>
              <div className="space-y-4">
                {breakdown.filter(b => b.count > 0).map((b) => (
                  <div key={b.method} className="flex items-center gap-3">
                    <span className="w-20 text-sm font-medium text-slate-700 flex-shrink-0">{b.label}</span>
                    <div className="flex-1 bg-slate-100 rounded-full h-2.5">
                      <div
                        className="bg-primary-400 h-2.5 rounded-full transition-all"
                        style={{ width: `${(b.revenue / maxBreakdown) * 100}%` }}
                      />
                    </div>
                    <span className="text-xs text-slate-400 w-8 text-right flex-shrink-0">{b.count}件</span>
                    <span className="text-sm font-bold text-slate-900 w-24 text-right flex-shrink-0">
                      ¥{Math.floor(b.revenue).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 商品別ランキング */}
          {topItems.length > 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
              <h3 className="text-sm font-bold text-slate-700 mb-5">
                商品別売上ランキング（Top {topItems.length}）
              </h3>
              <div className="space-y-4">
                {topItems.map((item, i) => (
                  <div key={item.name} className="flex items-center gap-3">
                    <span className={`w-6 text-center text-xs font-bold flex-shrink-0 ${
                      i === 0 ? 'text-slate-900' : i === 1 ? 'text-slate-400' : i === 2 ? 'text-slate-500' : 'text-slate-300'
                    }`}>
                      {i + 1}
                    </span>
                    <span className="flex-1 text-sm text-slate-800 font-medium truncate">
                      {item.name}
                    </span>
                    <span className="text-xs text-slate-400 flex-shrink-0">
                      {item.quantity_sold}杯
                    </span>
                    <div className="w-28 bg-slate-100 rounded-full h-2 flex-shrink-0">
                      <div
                        className="bg-primary-400 h-2 rounded-full transition-all"
                        style={{ width: `${(item.revenue / maxRevenue) * 100}%` }}
                      />
                    </div>
                    <span className="text-sm font-bold text-slate-900 w-20 text-right flex-shrink-0">
                      ¥{item.revenue.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl p-12 text-center shadow-sm">
              <p className="text-slate-400 text-sm">この日の売上データはありません</p>
            </div>
          )}
        </>
      )}
    </div>
  );

  if (inline) return content;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 fade-in">
      <div className="bg-white rounded-xl p-6 w-full max-w-3xl mx-4 shadow-xl max-h-[90vh] flex flex-col border border-slate-200 pop-in">
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
