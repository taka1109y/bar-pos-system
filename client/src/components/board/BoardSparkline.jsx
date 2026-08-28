import { useQuery } from '@tanstack/react-query';
import usePriceStore from '../../store/usePriceStore';
import { api } from '../../api';

// 価格ボード(取引所ビッグボード)行内の小さな値動きグラフ。
// POS版 Sparkline と同じ履歴API(GET /api/prices/:id/history)を使うが、
// 板の密な行に収まるよう「線のみ・セル幅いっぱい」に描く。色は tone(中心比)で決定。
const TONE_COLOR = {
  up:    '#1fe08a',
  down:  '#ff415e',
  crash: '#ff415e',
  flat:  '#5a6a83',
  none:  '#3a3a50',
};

export default function BoardSparkline({ itemId, basePrice, tone = 'flat' }) {
  const liveData  = usePriceStore((s) => s.prices[itemId]);
  const livePrice = liveData?.current_price ?? basePrice;

  const { data: history = [] } = useQuery({
    queryKey:        ['price-history', itemId],
    queryFn:         () => api.getPriceHistory(itemId, 24),
    staleTime:       30_000,
    refetchInterval: 35_000,
  });

  // 非有限値を除外(潰れ・歪み防止)。ライブ価格を末尾に追加。
  const prices = [...history.map((h) => h.price), livePrice]
    .map(Number)
    .filter((p) => Number.isFinite(p) && p >= 0);
  if (prices.length < 2) {
    // データ不足時は高さを維持する空要素(行の高さブレ防止)
    return <div style={{ height: 36, width: '100%' }} />;
  }

  const color = TONE_COLOR[tone] ?? TONE_COLOR.flat;
  const N     = prices.length;
  const min   = Math.min(...prices);
  const max   = Math.max(...prices);
  const range = max - min || 1;
  const toX   = (i) => (i / (N - 1)) * 100;
  const toY   = (p) => 27 - ((p - min) / range) * 24;
  const pts   = prices.map((p, i) => `${toX(i).toFixed(1)},${toY(p).toFixed(1)}`).join(' ');
  const lastX = toX(N - 1);
  const lastY = toY(prices[N - 1]);

  return (
    <svg
      viewBox="0 0 100 30"
      preserveAspectRatio="none"
      style={{ display: 'block', width: '100%', height: 36 }}
      aria-hidden="true"
    >
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="1.6"
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={lastX} cy={lastY} r="2.2" fill={color} />
    </svg>
  );
}
