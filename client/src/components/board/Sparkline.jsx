import { LineChart, Line, ResponsiveContainer } from 'recharts';

export default function Sparkline({ data, color = '#4ade80' }) {
  if (!data || data.length < 2) {
    return <div className="h-12 flex items-center justify-center text-slate-600 text-xs">─</div>;
  }

  const chartData = data.map((d, i) => ({ i, price: d.price }));

  return (
    <ResponsiveContainer width="100%" height={48}>
      <LineChart data={chartData}>
        <Line
          type="monotone"
          dataKey="price"
          stroke={color}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
