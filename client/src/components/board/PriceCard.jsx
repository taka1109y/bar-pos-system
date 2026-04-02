import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api';
import Sparkline from './Sparkline';

export default function PriceCard({ item }) {
  const [localHistory, setLocalHistory] = useState([]);
  const isUp = item.pct_change > 0;
  const isDown = item.pct_change < 0;

  const color    = isUp ? '#4ade80' : isDown ? '#f87171' : '#94a3b8';
  const bgColor  = isUp ? 'bg-green-950/60 border-green-700' : isDown ? 'bg-red-950/60 border-red-700' : 'bg-slate-800 border-slate-700';
  const textColor = isUp ? 'text-green-300' : isDown ? 'text-red-300' : 'text-slate-300';
  const arrow    = isUp ? '▲' : isDown ? '▼' : '─';

  const { data: history } = useQuery({
    queryKey: ['price-history', item.id],
    queryFn: () => api.getPriceHistory(item.id, 20),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (history) setLocalHistory(history);
  }, [history]);

  useEffect(() => {
    setLocalHistory((prev) => {
      const last = prev[prev.length - 1];
      if (last?.price === item.current_price) return prev;
      return [...prev, { price: item.current_price, recorded_at: new Date().toISOString() }].slice(-20);
    });
  }, [item.current_price]);

  return (
    <div className={`rounded-2xl border-2 p-5 flex flex-col gap-3 ${bgColor} transition-colors duration-1000`}>
      <div className="text-slate-400 text-sm font-medium truncate leading-snug">{item.name}</div>
      <div className={`text-4xl font-black tracking-tight leading-none ${textColor}`}>
        ¥{item.current_price.toLocaleString()}
      </div>
      <div className={`flex items-center gap-1.5 text-base font-bold ${textColor}`}>
        <span>{arrow}</span>
        <span>{Math.abs(item.pct_change).toFixed(1)}%</span>
        <span className="text-xs text-slate-500 font-normal ml-1">基準 ¥{item.base_price.toLocaleString()}</span>
      </div>
      <Sparkline data={localHistory} color={color} />
    </div>
  );
}
