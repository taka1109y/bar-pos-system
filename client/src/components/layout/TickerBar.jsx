import usePriceStore from '../../store/usePriceStore';

function TickerItem({ item }) {
  const isUp   = item.pct_change > 0;
  const isDown = item.pct_change < 0;
  const arrow  = isUp ? '▲' : isDown ? '▼' : '─';
  const trendColor = isUp ? '#00e5a0' : isDown ? '#ff4466' : '#3a3a50';
  const flashClass = item.flash === 'up' ? 'flash-up' : item.flash === 'down' ? 'flash-down' : '';

  return (
    <span
      className={`inline-flex items-center gap-2 px-5 ${flashClass}`}
      style={{ fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '1px' }}
    >
      <span style={{ color: '#3a3a50', fontSize: '12px' }}>·</span>
      <span style={{ color: '#7a7a90', fontSize: '12px' }}>{item.name}</span>
      <span style={{ color: '#ffc531', fontSize: '12px', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700 }}>
        ¥{item.current_price.toLocaleString()}
      </span>
      <span style={{ color: trendColor, fontSize: '12px', fontWeight: 700 }}>
        {arrow}{Math.abs(item.pct_change).toFixed(1)}%
      </span>
    </span>
  );
}

export default function TickerBar() {
  const pricesMap = usePriceStore((s) => s.prices);
  const prices    = Object.values(pricesMap);

  if (prices.length === 0) return null;

  const tickerItems = [...prices, ...prices];

  return (
    <div
      className="overflow-hidden flex-shrink-0"
      style={{
        background: '#0a0a0f',
        borderBottom: '1px solid #252532',
        height: '32px',
        display: 'flex',
        alignItems: 'center',
      }}
    >
      <div className="flex ticker-animate whitespace-nowrap items-center">
        {tickerItems.map((item, i) => (
          <TickerItem key={`${item.id}-${i}`} item={item} />
        ))}
      </div>
    </div>
  );
}
