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
    <div className="min-h-screen bg-slate-950 text-white p-10">
      {/* ヘッダー */}
      <div className="flex items-center justify-between mb-12">
        <div className="flex items-center gap-5">
          <div className="w-14 h-14 bg-amber-500/20 rounded-2xl flex items-center justify-center text-4xl">
            🍺
          </div>
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

      {/* 価格グリッド */}
      {prices.length === 0 ? (
        <div className="flex items-center justify-center h-64 text-slate-600 text-xl">
          接続中...
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
          {prices.map((item) => (
            <PriceCard key={item.id} item={item} />
          ))}
        </div>
      )}

      {/* フッター */}
      <div className="mt-12 text-center text-slate-700 text-sm tracking-wider">
        価格は需要に応じてリアルタイムで変動します
      </div>
    </div>
  );
}
