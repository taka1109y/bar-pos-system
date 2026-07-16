import { yen, num } from '../../utils/format';

// 粗利率の水準を色で示す。CostReportPage の日次粗利推移バッジと同じ閾値
function rateColor(rate) {
  if (rate >= 70) return 'bg-emerald-50 text-emerald-700';
  if (rate >= 50) return 'bg-amber-50 text-amber-700';
  return 'bg-red-50 text-red-700';
}

export default function CategoryBreakdown({ categories }) {
  const rows = categories ?? [];

  if (rows.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
        <h3 className="text-sm font-bold text-slate-700 mb-5">カテゴリ別売上構成</h3>
        <p className="text-base text-slate-500 text-center py-16">この期間の売上データはありません</p>
      </div>
    );
  }

  const maxRevenue = Math.max(...rows.map(r => r.revenue), 1);

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
      <h3 className="text-sm font-bold text-slate-700 mb-5">カテゴリ別売上構成</h3>
      <div className="space-y-4">
        {rows.map(c => (
          <div key={c.category_id} className="flex items-center gap-3">
            <div className="w-28 flex-shrink-0 min-w-0">
              <span className="text-sm font-medium text-slate-800 truncate block">{c.name}</span>
              <span className="text-xs text-slate-400">{c.quantity_sold}点</span>
            </div>
            <div className="flex-1 bg-slate-100 rounded-full h-2.5">
              <div
                className="bg-primary-400 h-2.5 rounded-full transition-all"
                style={{ width: `${(c.revenue / maxRevenue) * 100}%` }}
              />
            </div>
            <span className="text-xs text-slate-400 w-12 text-right flex-shrink-0 tabular-nums">
              {num(c.share_pct, 1)}%
            </span>
            <span className="text-sm font-bold text-slate-900 w-24 text-right flex-shrink-0 tabular-nums">
              ¥{yen(c.revenue)}
            </span>
            <span className={`w-20 text-right flex-shrink-0 text-sm font-medium tabular-nums ${
              c.gross_profit >= 0 ? 'text-emerald-700' : 'text-red-600'
            }`}>
              ¥{yen(c.gross_profit)}
            </span>
            <span className={`w-16 text-center flex-shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${rateColor(c.gross_profit_rate)}`}>
              {num(c.gross_profit_rate, 1)}%
            </span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 mt-4 pt-3 border-t border-slate-200 text-xs text-slate-400">
        <span className="w-28 flex-shrink-0">カテゴリ</span>
        <span className="flex-1" />
        <span className="w-12 text-right flex-shrink-0">構成比</span>
        <span className="w-24 text-right flex-shrink-0">売上</span>
        <span className="w-20 text-right flex-shrink-0">粗利</span>
        <span className="w-16 text-center flex-shrink-0">粗利率</span>
      </div>
    </div>
  );
}
