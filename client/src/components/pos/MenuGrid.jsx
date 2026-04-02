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
      className={`flex flex-col justify-between p-4 bg-white hover:bg-gray-50 active:scale-95 rounded-xl border border-gray-200 hover:border-gray-300 hover:shadow-sm transition-all text-left w-full ${
        flash === 'up' ? 'flash-up' : flash === 'down' ? 'flash-down' : ''
      }`}
    >
      <span className="text-sm font-semibold text-gray-800 leading-snug mb-3 line-clamp-2">
        {item.name}
      </span>
      <div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-base font-black text-gray-900">¥{price.toLocaleString()}</span>
          {item.is_drink && (
            <span
              className={`text-xs font-bold ${
                isUp ? 'text-emerald-600' : isDown ? 'text-red-500' : 'text-gray-400'
              }`}
            >
              {isUp ? '▲' : isDown ? '▼' : '—'}{pctChange !== 0 ? `${Math.abs(pctChange).toFixed(1)}%` : ''}
            </span>
          )}
        </div>
        {item.is_drink && (
          <div className="mt-2 w-full h-1 rounded-full bg-gray-200 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-1000 ${
                isUp ? 'bg-emerald-500' : isDown ? 'bg-red-400' : 'bg-gray-300'
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

  const subcatsForCat = subcategories.filter((s) => s.category_id === activeCat);

  const handleSelectCategory = (catId) => {
    setActiveCategory(catId);
    setActiveSubcategory(null);
  };

  const filteredItems = menuItems.filter((item) => {
    if (item.category_id !== activeCat) return false;
    if (activeSubcategory === null) return true;
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
            className={`px-4 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition-all flex-shrink-0 ${
              activeCat === cat.id
                ? 'bg-amber-500 text-white shadow-sm'
                : 'bg-white text-gray-500 hover:text-gray-800 border border-gray-200 hover:border-gray-300'
            }`}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {/* サブカテゴリタブ */}
      {subcatsForCat.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
          <button
            onClick={() => setActiveSubcategory(null)}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all flex-shrink-0 ${
              activeSubcategory === null
                ? 'bg-gray-700 text-white'
                : 'bg-white text-gray-400 hover:text-gray-700 border border-gray-200'
            }`}
          >
            すべて
          </button>
          {subcatsForCat.map((sub) => (
            <button
              key={sub.id}
              onClick={() => setActiveSubcategory(sub.id)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all flex-shrink-0 ${
                activeSubcategory === sub.id
                  ? 'bg-gray-700 text-white'
                  : 'bg-white text-gray-400 hover:text-gray-700 border border-gray-200'
              }`}
            >
              {sub.name}
            </button>
          ))}
        </div>
      )}

      {/* メニューグリッド */}
      <div className="grid grid-cols-2 gap-3">
        {filteredItems.map((item) => (
          <MenuItem key={item.id} item={item} onAdd={onAddItem} />
        ))}
      </div>
    </div>
  );
}
