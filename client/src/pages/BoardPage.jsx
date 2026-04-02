import { useEffect, useState } from 'react';
import { api } from '../api';
import socket from '../socket';
import usePriceStore from '../store/usePriceStore';
import PriceCard from '../components/board/PriceCard';

function Clock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="font-mono text-slate-400 text-lg">
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
    <div className="min-h-screen bg-slate-950 text-white p-8">
      {/* ヘッダー */}
      <div className="flex items-center justify-between mb-10">
        <div className="flex items-center gap-4">
          <span className="text-5xl">🍺</span>
          <div>
            <h1 className="text-3xl font-black tracking-tight leading-tight">SPORTS BAR</h1>
            <p className="text-slate-500 text-sm mt-0.5">LIVE DRINK PRICES</p>
          </div>
        </div>
        <div className="text-right">
          <Clock />
          <p className="text-slate-600 text-xs mt-1">30秒ごとに更新</p>
        </div>
      </div>

      {/* 価格グリッド */}
      {prices.length === 0 ? (
        <div className="flex items-center justify-center h-64 text-slate-600 text-xl">
          接続中...
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-5">
          {prices.map((item) => (
            <PriceCard key={item.id} item={item} />
          ))}
        </div>
      )}

      {/* フッター */}
      <div className="mt-10 text-center text-slate-700 text-sm">
        価格は需要に応じてリアルタイムで変動します
      </div>
    </div>
  );
}
