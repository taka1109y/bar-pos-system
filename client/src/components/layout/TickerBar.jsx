import { useLayoutEffect, useRef, useState } from 'react';
import usePriceStore from '../../store/usePriceStore';
import { yen, num } from '../../utils/format';

// 商品数(=コンテンツ幅)が増えても体感速度が変わらないよう、px/秒を固定して秒数を逆算する
// (旧実装は60秒固定で、商品数が多いほど実質的に速くなっていた。現在の想定商品数では
//  旧実装の速度が概ね35〜40px/秒程度だったため、それより明確に遅い値を採用する)
const PX_PER_SECOND = 28;
const MIN_DURATION_SECONDS = 25;

function TickerItem({ item }) {
  const pct    = Number(item.pct_change) || 0;
  const isUp   = pct > 0;
  const isDown = pct < 0;
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
        ¥{yen(item.current_price)}
      </span>
      <span style={{ color: trendColor, fontSize: '12px', fontWeight: 700 }}>
        {arrow}{num(Math.abs(pct), 1)}%
      </span>
    </span>
  );
}

export default function TickerBar() {
  // usePriceStore((s) => s.getAllPrices()) は呼ぶたびに新しい配列を返すため、
  // Zustandのセレクターとして使うと参照が毎回変わり無限レンダリングループになる。
  // BoardPage.jsx と同様に、ストア全体を購読してから関数として呼び出す。
  const { order, prices: priceMap } = usePriceStore();
  const prices = order.map((id) => priceMap[id]).filter(Boolean);

  const trackRef = useRef(null);
  const [duration, setDuration] = useState(null);

  // 複製前(1セット分)の実際のコンテンツ幅を計測し、px/秒が一定になるよう秒数を逆算する
  useLayoutEffect(() => {
    if (!trackRef.current) return;
    const singleSetWidth = trackRef.current.scrollWidth / 2;
    if (!singleSetWidth) return;
    setDuration(Math.max(singleSetWidth / PX_PER_SECOND, MIN_DURATION_SECONDS));
  }, [prices.length]);

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
      <div
        ref={trackRef}
        className="flex ticker-animate whitespace-nowrap items-center"
        style={duration ? { animationDuration: `${duration}s` } : undefined}
      >
        {tickerItems.map((item, i) => (
          <TickerItem key={`${item.id}-${i}`} item={item} />
        ))}
      </div>
    </div>
  );
}
