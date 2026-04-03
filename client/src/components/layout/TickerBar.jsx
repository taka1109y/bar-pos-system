import usePriceStore from '../../store/usePriceStore';

function TickerItem({ item }) {
  const isUp = item.pct_change > 0;
  const isDown = item.pct_change < 0;
  const arrow = isUp ? '▲' : isDown ? '▼' : '─';
  const colorClass = isUp ? 'text-green-400' : isDown ? 'text-red-400' : 'text-slate-500';
  const flashClass = item.flash === 'up' ? 'flash-up' : item.flash === 'down' ? 'flash-down' : '';

  return (
    <span className={`inline-flex items-center gap-1.5 px-5 ${flashClass}`}>
      <span className="text-amber-300 font-semibold">{item.name}</span>
      <span className="font-black text-amber-400">¥{item.current_price.toLocaleString()}</span>
      <span className={`text-xs font-bold ${colorClass}`}>
        {arrow}{Math.abs(item.pct_change).toFixed(1)}%
      </span>
      <span className="text-slate-700 ml-1">·</span>
    </span>
  );
}

export default function TickerBar() {
  const pricesMap = usePriceStore((s) => s.prices);
  const prices = Object.values(pricesMap);

  if (prices.length === 0) return null;

  const tickerItems = [...prices, ...prices];

  return (
    <div className="bg-slate-950 border-b border-slate-800 py-2.5 overflow-hidden">
      <div className="flex ticker-animate whitespace-nowrap">
        {tickerItems.map((item, i) => (
          <TickerItem key={`${item.id}-${i}`} item={item} />
        ))}
      </div>
    </div>
  );
}
