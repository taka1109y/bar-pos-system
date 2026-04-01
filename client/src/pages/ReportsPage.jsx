import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { api } from '../api';

export default function ReportsPage({ onClose }) {
  const today = new Date().toISOString().split('T')[0];
  const [date, setDate] = useState(today);

  const { data: report, isLoading } = useQuery({
    queryKey: ['report-daily', date],
    queryFn: () => api.getDailyReport(date),
  });

  const { data: hourlyData } = useQuery({
    queryKey: ['report-hourly', date],
    queryFn: () => api.getHourlyReport(date),
  });

  const topItems = report?.items?.slice(0, 10) || [];
  const maxRevenue = topItems[0]?.revenue || 1;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-slate-800 rounded-2xl p-6 w-full max-w-3xl mx-4 shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-white">売上レポート</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">✕</button>
        </div>

        {/* 日付選択 */}
        <div className="mb-4">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="flex-1 overflow-y-auto space-y-6">
          {isLoading ? (
            <div className="text-slate-400 text-center py-8">読み込み中...</div>
          ) : (
            <>
              {/* サマリーカード */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-slate-700 rounded-xl p-4 text-center">
                  <div className="text-2xl font-black text-yellow-300">¥{report?.total_revenue?.toLocaleString() || 0}</div>
                  <div className="text-xs text-slate-400 mt-1">総売上</div>
                </div>
                <div className="bg-slate-700 rounded-xl p-4 text-center">
                  <div className="text-2xl font-black text-blue-300">{report?.order_count || 0}</div>
                  <div className="text-xs text-slate-400 mt-1">会計件数</div>
                </div>
                <div className="bg-slate-700 rounded-xl p-4 text-center">
                  <div className="text-2xl font-black text-emerald-300">¥{report?.avg_order_value?.toLocaleString() || 0}</div>
                  <div className="text-xs text-slate-400 mt-1">平均単価</div>
                </div>
              </div>

              {/* 時間別売上グラフ */}
              {hourlyData?.hourly?.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-slate-400 mb-3">時間別売上</h3>
                  <ResponsiveContainer width="100%" height={120}>
                    <BarChart data={hourlyData.hourly}>
                      <XAxis dataKey="hour" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                      <YAxis hide />
                      <Tooltip
                        contentStyle={{ background: '#1e293b', border: '1px solid #475569', borderRadius: 8 }}
                        labelStyle={{ color: '#94a3b8' }}
                        formatter={(v) => [`¥${v.toLocaleString()}`, '売上']}
                      />
                      <Bar dataKey="revenue" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* 商品別ランキング */}
              {topItems.length > 0 ? (
                <div>
                  <h3 className="text-sm font-semibold text-slate-400 mb-3">商品別売上 Top {topItems.length}</h3>
                  <div className="space-y-2">
                    {topItems.map((item, i) => (
                      <div key={item.name} className="flex items-center gap-3">
                        <span className="text-slate-500 text-xs w-4">{i + 1}</span>
                        <span className="flex-1 text-sm text-white truncate">{item.name}</span>
                        <span className="text-xs text-slate-400">{item.quantity_sold}杯</span>
                        <div className="w-32 bg-slate-700 rounded-full h-1.5">
                          <div
                            className="bg-blue-500 h-1.5 rounded-full"
                            style={{ width: `${(item.revenue / maxRevenue) * 100}%` }}
                          />
                        </div>
                        <span className="text-sm font-bold text-yellow-300 w-20 text-right">¥{item.revenue.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-slate-500 text-center py-8">この日の売上データはありません</div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
