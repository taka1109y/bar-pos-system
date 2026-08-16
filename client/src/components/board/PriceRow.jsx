import { useEffect, useRef, useState } from 'react';
import { yen, num } from '../../utils/format';

export default function PriceRow({ item }) {
  const pct    = Number(item.pct_change) || 0;
  const isUp   = pct > 0;
  const isDown = pct < 0;

  const rowBg       = isUp ? 'bg-green-950/70' : isDown ? 'bg-red-950/70' : 'bg-slate-800/60';
  const changeColor = isUp ? 'text-green-400' : isDown ? 'text-red-400' : 'text-slate-500';

  // 時価(price_editable / base_price 0・null)は金額を出さず「時価」表示(¥0で無料に見えないように)
  const isJika = !item.base_price;
  const curPrice = Math.max(0, Number(item.current_price) || 0); // 負値ガード

  const amtChange  = curPrice - (Number(item.base_price) || 0);
  const amtDisplay = amtChange < 0 ? `-${yen(Math.abs(amtChange))}` : `${yen(amtChange)}`;
  const pctDisplay = pct < 0 ? `-${num(Math.abs(pct), 1)}%` : `${num(Math.abs(pct), 1)}%`;

  // 価格変化時に現在値セルをフラッシュ(値更新が「生きている」ように見せる。同方向連続でも再発火)
  const prevPrice = useRef(curPrice);
  const [flashDir, setFlashDir] = useState('');
  const [flashKey, setFlashKey] = useState(0);
  useEffect(() => {
    const prev = Number(prevPrice.current) || 0;
    if (curPrice !== prev) {
      setFlashDir(curPrice > prev ? 'flash-up' : 'flash-down');
      setFlashKey((k) => k + 1); // key を変えてアニメーションを毎回リスタート
      prevPrice.current = curPrice;
    }
  }, [curPrice]);

  return (
    <tr className={`${rowBg} border-b border-slate-700/50 transition-colors duration-700`}>
      <td className="px-4 py-3 text-slate-400 font-semibold whitespace-nowrap overflow-hidden text-ellipsis max-w-[22vw]">{item.name}</td>
      <td className="px-4 py-3 text-slate-400 text-right tabular-nums">
        {isJika ? '時価' : `¥${yen(item.base_price)}`}
      </td>
      <td key={flashKey} className={`px-4 py-3 text-amber-300 font-bold text-right tabular-nums ${flashDir}`}>
        {isJika ? '時価' : `¥${yen(curPrice)}`}
      </td>
      <td className={`px-4 py-3 font-bold text-right tabular-nums ${changeColor}`}>
        {isJika ? '—' : amtDisplay}
      </td>
      <td className={`px-4 py-3 font-bold text-right tabular-nums ${changeColor}`}>
        {isJika ? '—' : pctDisplay}
      </td>
      <td className="px-4 py-3 text-slate-400 text-right tabular-nums">
        {isJika ? '—' : `¥${yen(item.day_high ?? curPrice)}`}
      </td>
      <td className="px-4 py-3 text-slate-400 text-right tabular-nums">
        {isJika ? '—' : `¥${yen(item.day_low ?? curPrice)}`}
      </td>
    </tr>
  );
}
