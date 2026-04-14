import { useQuery } from '@tanstack/react-query';
import usePriceStore from '../../store/usePriceStore';
import { api } from '../../api';

const W   = 100; // viewBox 幅（SVG 内部座標）
const H   = 22;  // viewBox 高さ
const PAD = 3;   // 上下パディング

export default function Sparkline({ itemId, basePrice, isUp, isDown }) {
  const liveData  = usePriceStore((s) => s.prices[itemId]);
  const livePrice = liveData?.current_price ?? basePrice;

  const { data: history = [] } = useQuery({
    queryKey: ['price-history', itemId],
    queryFn:  () => api.getPriceHistory(itemId, 14),
    staleTime: 30_000,
    refetchInterval: 35_000,
  });

  // 履歴（時系列順）＋リアルタイム現在価格を末尾に追加
  const prices = [...history.map((h) => h.price), livePrice];
  const N      = prices.length;
  const color  = isUp ? '#10b981' : isDown ? '#ef4444' : '#94a3b8';

  const min   = Math.min(...prices);
  const max   = Math.max(...prices);
  const range = max - min;

  const toX = (i) => (i / Math.max(N - 1, 1)) * W;
  const toY = (p) =>
    range > 0
      ? PAD + (1 - (p - min) / range) * (H - PAD * 2)
      : H / 2;

  const baseY  = Math.max(PAD, Math.min(H - PAD, toY(basePrice)));
  const lastX  = toX(N - 1);
  const lastY  = toY(prices[N - 1]);

  const polyPoints = prices.map((p, i) => `${toX(i)},${toY(p)}`).join(' ');

  // 面塗りパス（折れ線の下を閉じる）
  const fillD =
    `M ${toX(0)},${toY(prices[0])} ` +
    prices.map((p, i) => `L ${toX(i)},${toY(p)}`).join(' ') +
    ` L ${lastX},${H} L ${toX(0)},${H} Z`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="w-full h-7 mt-1.5"
    >
      {/* 基準価格の破線 */}
      <line
        x1="0" y1={baseY} x2={W} y2={baseY}
        stroke="#cbd5e1"
        strokeWidth="0.6"
        strokeDasharray="2,2"
      />
      {/* 面塗り */}
      <path d={fillD} fill={color} fillOpacity="0.12" />
      {/* 折れ線 */}
      <polyline
        points={polyPoints}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* 最新価格点（●） */}
      <circle cx={lastX} cy={lastY} r="2.5" fill={color} />
    </svg>
  );
}
