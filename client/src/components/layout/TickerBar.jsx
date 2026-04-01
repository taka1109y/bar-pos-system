import usePriceStore from '../../store/usePriceStore';

function TickerItem({ item }) {
  const isUp = item.pct_change > 0;
  const isDown = item.pct_change < 0;
  const arrow = isUp ? '▲' : isDown ? '▼' : '─';
  const colorClass = isUp ? 'text-green-400' : isDown ? 'text-red-400' : 'text-slate-400';
  const flashClass = item.flash === 'up' ? 'flash-up' : item.flash === 'down' ? 'flash-down' : '';

  return (
    <span className={`inline-flex items-center gap-1 px-4 ${flashClass}`}>
      <span className="text-slate-300 font-medium">{item.name}</span>
      <span className={`font-bold ${colorClass}`}>¥{item.current_price.toLocaleString()}</span>
      <span className={`text-xs ${colorClass}`}>
        {arrow}{Math.abs(item.pct_change).toFixed(1)}%
      </span>
      <span className="text-slate-600 ml-2">|</span>
    </span>
  );
}

export default function TickerBar() {
  const pricesMap = usePriceStore((s) => s.prices);
  const prices = Object.values(pricesMap);

  if (prices.length === 0) return null;

  const tickerItems = [...prices, ...prices]; // 2倍にしてシームレスなループ

  return (
    <div className="bg-slate-900 border-b border-slate-700 py-2 overflow-hidden">
      <div className="flex ticker-animate whitespace-nowrap">
        {tickerItems.map((item, i) => (
          <TickerItem key={`${item.id}-${i}`} item={item} />
        ))}
      </div>
    </div>
  );
}
