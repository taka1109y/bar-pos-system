import { useQuery } from '@tanstack/react-query';
import usePriceStore from '../../store/usePriceStore';
import { api } from '../../api';

const W = 160;
const H = 36;

export default function Sparkline({ itemId, basePrice, isUp, isDown, darkBg = false }) {
  const liveData  = usePriceStore((s) => s.prices[itemId]);
  const livePrice = liveData?.current_price ?? basePrice;

  const { data: history = [] } = useQuery({
    queryKey:        ['price-history', itemId],
    queryFn:         () => api.getPriceHistory(itemId, 24),
    staleTime:       30_000,
    refetchInterval: 35_000,
  });

  const prices = [...history.map((h) => h.price), livePrice];
  if (prices.length < 2) return null;

  const color  = isUp ? '#00e5a0' : isDown ? '#ff4466' : '#3a3a50';
  const N      = prices.length;
  const min    = Math.min(...prices);
  const max    = Math.max(...prices);
  const range  = max - min || 1;
  const toX    = (i) => (i / (N - 1)) * W;
  const toY    = (p) => H - ((p - min) / range) * (H - 4) - 2;
  const pts    = prices.map((p, i) => `${toX(i)},${toY(p)}`);
  const lastX  = toX(N - 1);
  const lastY  = toY(prices[N - 1]);
  const area   = `${toX(0)},${H} ${pts.join(' ')} ${lastX},${H}`;
  const gradId = `sg-${color.replace('#', '')}`;

  const svg = (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ display: 'block', width: '100%', height: H }}
    >
      <defs>
        <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0"   />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${gradId})`} />
      <polyline
        points={pts.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={lastX} cy={lastY} r="3" fill={color} stroke={darkBg ? '#1e1e28' : '#fff'} strokeWidth="1.5" />
    </svg>
  );

  if (darkBg) {
    return (
      <div style={{ width: '80%', margin: '6px auto 0', borderRadius: 6, overflow: 'hidden', background: 'rgba(0,0,0,0.3)', padding: '4px 4px 2px' }}>
        {svg}
      </div>
    );
  }

  return <div style={{ width: '80%', margin: '6px auto 0' }}>{svg}</div>;
}
