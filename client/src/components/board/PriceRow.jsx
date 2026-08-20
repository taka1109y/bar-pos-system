import { useEffect, useRef, useState } from 'react';
import { yen, num } from '../../utils/format';
import { priceDisplay } from '../../utils/priceTone';

export default function PriceRow({ item, crashRemain }) {
  // 色/▲▼は「寄り付き価格(pricing_base=中心)比」。定価(base_price)は板に出さない。
  const disp    = priceDisplay(item);
  const crashed = disp.tone === 'crash';
  const isUp    = disp.tone === 'up';
  const isDown  = disp.tone === 'down';
  const variable = disp.variable;

  const rowBg = crashed
    ? 'bg-red-950/80'
    : isUp ? 'bg-green-950/70' : isDown ? 'bg-red-950/70' : 'bg-slate-800/60';
  const changeColor = crashed
    ? 'text-red-300'
    : isUp ? 'text-green-400' : isDown ? 'text-red-400' : 'text-slate-500';

  // 時価(price_editable / base_price 0・null)は金額を出さず「時価」表示
  const isJika   = !item.base_price;
  const curPrice = Math.max(0, Number(item.current_price) || 0); // 負値ガード
  const center   = Number(item.pricing_base) || 0;               // 本日の寄り付き価格(=基準値)

  // 基準値=寄り付き価格。変動幅/%は寄り付き比。固定(engine_off)・時価・暴落中は変動を出さない。
  const showChange = variable && !isJika;
  const amtChange  = curPrice - center;
  const amtDisplay = amtChange < 0 ? `-${yen(Math.abs(amtChange))}` : `${yen(amtChange)}`;
  const centerPct  = Number(item.center_pct) || 0;
  const pctDisplay = centerPct < 0 ? `-${num(Math.abs(centerPct), 1)}%` : `${num(Math.abs(centerPct), 1)}%`;
  // 基準値セル: 変動対象=寄り付き価格 / 固定=現在価格(定価) / 時価=時価
  const baseCell   = isJika ? '時価' : variable ? `¥${yen(center)}` : `¥${yen(curPrice)}`;

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
      <td className="px-4 py-3 text-slate-400 font-semibold whitespace-nowrap overflow-hidden text-ellipsis max-w-[22vw]">
        {item.name}
        {crashed && (
          <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded bg-red-600 text-white text-xs font-extrabold tracking-wide align-middle">
            CRASH{crashRemain ? ` ${crashRemain}` : ''}
          </span>
        )}
      </td>
      <td className="px-4 py-3 text-slate-400 text-right tabular-nums">{baseCell}</td>
      <td key={flashKey} className={`px-4 py-3 text-amber-300 font-bold text-right tabular-nums ${flashDir}`}>
        {isJika ? '時価' : `¥${yen(curPrice)}`}
      </td>
      <td className={`px-4 py-3 font-bold text-right tabular-nums ${changeColor}`}>
        {showChange ? amtDisplay : '—'}
      </td>
      <td className={`px-4 py-3 font-bold text-right tabular-nums ${changeColor}`}>
        {showChange ? pctDisplay : '—'}
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
