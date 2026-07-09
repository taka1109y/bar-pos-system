import { useEffect, useState } from 'react';
import { api } from '../api';
import socket from '../socket';
import usePriceStore from '../store/usePriceStore';
import PriceRow from '../components/board/PriceRow';
import { yen, num } from '../utils/format';

function Ticker({ prices }) {
  if (prices.length === 0) return null;
  const items = [...prices, ...prices];
  return (
    <div className="fixed bottom-0 left-0 right-0 bg-slate-900/95 border-t border-slate-700/60 overflow-hidden py-2">
      <div className="flex whitespace-nowrap" style={{ animation: 'ticker 40s linear infinite' }}>
        {items.map((item, i) => {
          const pct    = Number(item.pct_change) || 0;
          const isUp   = pct > 0;
          const isDown = pct < 0;
          const pctColor   = isUp ? 'text-green-400' : isDown ? 'text-red-400' : 'text-slate-500';
          const pctDisplay = pct < 0 ? `-${num(Math.abs(pct), 1)}%` : `${num(Math.abs(pct), 1)}%`;
          return (
            <span key={i} className="inline-flex items-center gap-3 mx-10">
              <span className="text-slate-300 font-semibold tracking-wide">{item.name}</span>
              <span className="text-amber-300 font-bold tabular-nums">¥{yen(item.current_price)}</span>
              <span className={`font-bold tabular-nums ${pctColor}`}>{pctDisplay}</span>
            </span>
          );
        })}
      </div>
      <style>{`@keyframes ticker { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }`}</style>
    </div>
  );
}

function Clock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="font-mono text-amber-400 text-2xl font-bold tracking-widest">
      {time.toLocaleTimeString('ja-JP')}
    </span>
  );
}

export default function BoardPage() {
  const { initPrices, updatePrices, getAllPrices } = usePriceStore();
  const prices = getAllPrices();

  useEffect(() => {
    api.getPrices().then(initPrices).catch(console.error);
  }, []);

  useEffect(() => {
    const handle = ({ items }) => updatePrices(items);
    socket.on('prices:updated', handle);
    return () => socket.off('prices:updated', handle);
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-white p-8 pb-16">
      {/* ヘッダー */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-5">
          <img src="/FANZONE_logo_A2.png" alt="ロゴ" className="h-14 w-auto object-contain" />
          <div>
            <h1 className="text-4xl font-black tracking-widest leading-tight text-white">
              SPORTS BAR
            </h1>
            <p className="text-slate-500 text-sm mt-1 tracking-[0.4em] font-semibold uppercase">
              Live Drink Prices
            </p>
          </div>
        </div>
        <div className="text-right">
          <Clock />
          <p className="text-slate-600 text-xs mt-1 tracking-wider">30秒ごとに更新</p>
        </div>
      </div>

      {/* 価格テーブル */}
      {prices.length === 0 ? (
        <div className="flex items-center justify-center h-64 text-slate-600 text-xl">
          接続中...
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden border border-slate-700/50">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-900 text-xs text-slate-500 uppercase tracking-widest border-b border-slate-700">
                <th className="px-4 py-3 text-left">商品名</th>
                <th className="px-4 py-3 text-right">基準値</th>
                <th className="px-4 py-3 text-right">現在値</th>
                <th className="px-4 py-3 text-right">変動幅(円)</th>
                <th className="px-4 py-3 text-right">変動幅(%)</th>
                <th className="px-4 py-3 text-right">同日高値</th>
                <th className="px-4 py-3 text-right">同日底値</th>
              </tr>
            </thead>
            <tbody>
              {prices.map((item) => (
                <PriceRow key={item.id} item={item} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* フッター */}
      <div className="mt-8 text-center text-slate-700 text-sm tracking-wider">
        価格は需要に応じてリアルタイムで変動します
      </div>

      <Ticker prices={prices} />
    </div>
  );
}
