import { useState } from 'react';
import usePriceStore from '../../store/usePriceStore';

function MenuItem({ item, onAdd }) {
  const livePrice = usePriceStore((s) => s.prices[item.id]);
  const price = livePrice?.current_price ?? item.current_price;
  const pctChange = livePrice?.pct_change ?? 0;
  const isUp = pctChange > 0;
  const isDown = pctChange < 0;

  return (
    <button
      onClick={() => onAdd(item)}
      className="flex flex-col items-start p-3 bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 hover:border-slate-500 transition-colors text-left"
    >
      <span className="text-sm font-medium text-white leading-tight">{item.name}</span>
      <div className="flex items-center gap-1 mt-1">
        <span className="text-base font-bold text-yellow-300">¥{price.toLocaleString()}</span>
        {item.is_drink && pctChange !== 0 && (
          <span className={`text-xs ${isUp ? 'text-green-400' : 'text-red-400'}`}>
            {isUp ? '▲' : '▼'}{Math.abs(pctChange).toFixed(1)}%
          </span>
        )}
      </div>
    </button>
  );
}

export default function MenuGrid({ menuItems, categories, onAddItem }) {
  const [activeCategory, setActiveCategory] = useState(null);

  const activeCat = activeCategory || categories[0]?.id;
  const filteredItems = menuItems.filter((item) => item.category_id === activeCat);

  return (
    <div className="flex flex-col gap-2">
      {/* カテゴリタブ */}
      <div className="flex gap-1 flex-wrap">
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              activeCat === cat.id
                ? 'bg-blue-600 text-white'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {/* メニューグリッド */}
      <div className="grid grid-cols-2 gap-2">
        {filteredItems.map((item) => (
          <MenuItem key={item.id} item={item} onAdd={onAddItem} />
        ))}
      </div>
    </div>
  );
}
