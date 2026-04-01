import { useState } from 'react';
import usePriceStore from '../../store/usePriceStore';

function MenuItem({ item, onAdd }) {
  const livePrice = usePriceStore((s) => s.prices[item.id]);
  const price     = livePrice?.current_price ?? item.current_price;
  const pctChange = livePrice?.pct_change ?? 0;
  const flash     = livePrice?.flash;
  const isUp   = pctChange > 0;
  const isDown = pctChange < 0;

  return (
    <button
      onClick={() => onAdd(item)}
      className={`flex flex-col justify-between p-4 bg-slate-800 hover:bg-slate-750 active:scale-95 rounded-2xl border border-slate-700/60 hover:border-slate-500/80 transition-all text-left w-full group ${
        flash === 'up' ? 'flash-up' : flash === 'down' ? 'flash-down' : ''
      }`}
    >
      <span className="text-sm font-semibold text-white leading-snug mb-3 line-clamp-2">
        {item.name}
      </span>
      <div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-lg font-black text-yellow-300">¥{price.toLocaleString()}</span>
          {item.is_drink && (
            <span
              className={`text-xs font-bold ${
                isUp ? 'text-green-400' : isDown ? 'text-red-400' : 'text-slate-500'
              }`}
            >
              {isUp ? '▲' : isDown ? '▼' : '—'}{pctChange !== 0 ? `${Math.abs(pctChange).toFixed(1)}%` : ''}
            </span>
          )}
        </div>
        {item.is_drink && (
          <div className="mt-1.5 w-full h-0.5 rounded-full bg-slate-700 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-1000 ${
                isUp ? 'bg-green-500' : isDown ? 'bg-red-500' : 'bg-slate-600'
              }`}
              style={{ width: `${Math.min(100, 50 + pctChange * 5)}%` }}
            />
          </div>
        )}
      </div>
    </button>
  );
}

export default function MenuGrid({ menuItems, categories, subcategories = [], onAddItem }) {
  const [activeCategory,    setActiveCategory]    = useState(null);
  const [activeSubcategory, setActiveSubcategory] = useState(null);

  const activeCat = activeCategory || categories[0]?.id;

  // 選択中カテゴリに属するサブカテゴリ
  const subcatsForCat = subcategories.filter((s) => s.category_id === activeCat);

  // カテゴリ切り替え時はサブカテゴリをリセット
  const handleSelectCategory = (catId) => {
    setActiveCategory(catId);
    setActiveSubcategory(null);
  };

  // フィルタリング: カテゴリ → サブカテゴリ
  const filteredItems = menuItems.filter((item) => {
    if (item.category_id !== activeCat) return false;
    if (activeSubcategory === null) return true;           // "すべて"
    return item.subcategory_id === activeSubcategory;
  });

  return (
    <div className="flex flex-col gap-3">
      {/* カテゴリタブ */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => handleSelectCategory(cat.id)}
            className={`px-4 py-2 rounded-full text-sm font-semibold whitespace-nowrap transition-all flex-shrink-0 ${
              activeCat === cat.id
                ? 'bg-amber-500 text-white shadow-md shadow-amber-500/30'
                : 'bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700 border border-slate-700/60'
            }`}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {/* サブカテゴリタブ (存在する場合のみ表示) */}
      {subcatsForCat.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
          {/* "すべて" タブ */}
          <button
            onClick={() => setActiveSubcategory(null)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all flex-shrink-0 ${
              activeSubcategory === null
                ? 'bg-slate-500 text-white'
                : 'bg-slate-800/60 text-slate-500 hover:text-slate-300 border border-slate-700/40'
            }`}
          >
            すべて
          </button>
          {subcatsForCat.map((sub) => (
            <button
              key={sub.id}
              onClick={() => setActiveSubcategory(sub.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all flex-shrink-0 ${
                activeSubcategory === sub.id
                  ? 'bg-slate-500 text-white'
                  : 'bg-slate-800/60 text-slate-500 hover:text-slate-300 border border-slate-700/40'
              }`}
            >
              {sub.name}
            </button>
          ))}
        </div>
      )}

      {/* メニューグリッド */}
      <div className="grid grid-cols-2 gap-2.5">
        {filteredItems.map((item) => (
          <MenuItem key={item.id} item={item} onAdd={onAddItem} />
        ))}
      </div>
    </div>
  );
}
