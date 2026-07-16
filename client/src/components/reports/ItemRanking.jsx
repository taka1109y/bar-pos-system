import { useState } from 'react';
import { yen, num } from '../../utils/format';

const SORTS = [
  { id: 'revenue',      label: '売上順',   compare: (a, b) => b.revenue - a.revenue },
  { id: 'gross_profit', label: '粗利順',   compare: (a, b) => b.gross_profit - a.gross_profit },
  { id: 'quantity',     label: '販売数順', compare: (a, b) => b.quantity_sold - a.quantity_sold },
];

const LIMIT = 10;

export default function ItemRanking({ items }) {
  const [sortId, setSortId] = useState('revenue');
  const [expanded, setExpanded] = useState(false);

  const all = items ?? [];
  if (all.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-12 text-center shadow-sm">
        <p className="text-base text-slate-500">この期間の売上データはありません</p>
      </div>
    );
  }

  const sort = SORTS.find(s => s.id === sortId) ?? SORTS[0];
  const sorted = [...all].sort(sort.compare);
  const shown = expanded ? sorted : sorted.slice(0, LIMIT);
  // 粗利順のときはバーも粗利を基準にする
  const barOf = (item) => (sortId === 'gross_profit' ? item.gross_profit : item.revenue);
  const maxValue = Math.max(...shown.map(i => Math.abs(barOf(i))), 1);

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-sm font-bold text-slate-700">
          商品別ランキング（{shown.length}／{all.length}品）
        </h3>
        <div className="relative">
          <label htmlFor="item-sort" className="sr-only">並び替え</label>
          <select
            id="item-sort"
            value={sortId}
            onChange={(e) => setSortId(e.target.value)}
            className="h-8 appearance-none pl-3 pr-8 text-sm border border-slate-300 rounded-lg bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary-500/50"
          >
            {SORTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <svg className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </div>

      <div className="space-y-4">
        {shown.map((item, i) => {
          const barValue = barOf(item);
          return (
            <div key={item.menu_item_id ?? item.name} className="flex items-center gap-3">
              <span className={`w-6 text-center text-xs font-bold flex-shrink-0 ${
                i === 0 ? 'text-slate-900' : i === 1 ? 'text-slate-400' : i === 2 ? 'text-slate-500' : 'text-slate-300'
              }`}>
                {i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <span className="text-sm text-slate-800 font-medium truncate block">{item.name}</span>
                {item.cost_per_unit > 0 ? (
                  <span className="text-xs text-slate-400">
                    原価率 {num(item.cost_rate, 1)}% ／ 粗利 ¥{yen(item.gross_profit)}
                  </span>
                ) : (
                  <span className="text-xs text-amber-600">原価未設定</span>
                )}
              </div>
              <span className="text-xs text-slate-400 flex-shrink-0 w-12 text-right tabular-nums">
                {item.quantity_sold}点
              </span>
              <div className="w-28 bg-slate-100 rounded-full h-2 flex-shrink-0">
                <div
                  className={`h-2 rounded-full transition-all ${barValue >= 0 ? 'bg-primary-400' : 'bg-red-400'}`}
                  style={{ width: `${Math.min((Math.abs(barValue) / maxValue) * 100, 100)}%` }}
                />
              </div>
              <span className="text-sm font-bold text-slate-900 w-20 text-right flex-shrink-0 tabular-nums">
                ¥{yen(item.revenue)}
              </span>
            </div>
          );
        })}
      </div>

      {all.length > LIMIT && (
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="mt-5 w-full h-9 inline-flex items-center justify-center text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer"
        >
          {expanded ? '上位10品のみ表示' : `全${all.length}品を表示`}
        </button>
      )}
    </div>
  );
}
