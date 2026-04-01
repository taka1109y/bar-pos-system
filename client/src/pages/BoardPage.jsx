import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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
    <span className="font-mono text-slate-400">
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
    socket.on('prices:updated', ({ items }) => {
      updatePrices(items);
    });
    return () => socket.off('prices:updated');
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      {/* ヘッダー */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <span className="text-4xl">🍺</span>
          <div>
            <h1 className="text-3xl font-black tracking-tight">SPORTS BAR</h1>
            <p className="text-slate-500 text-sm">LIVE DRINK PRICES</p>
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
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {prices.map((item) => (
            <PriceCard key={item.id} item={item} />
          ))}
        </div>
      )}

      {/* フッター */}
      <div className="mt-8 text-center text-slate-700 text-xs">
        価格は需要に応じてリアルタイムで変動します
      </div>
    </div>
  );
}
