import { yen, num } from '../../utils/format';

export default function PriceRow({ item }) {
  const pct    = Number(item.pct_change) || 0;
  const isUp   = pct > 0;
  const isDown = pct < 0;

  const rowBg       = isUp ? 'bg-green-950/70' : isDown ? 'bg-red-950/70' : 'bg-slate-800/60';
  const changeColor = isUp ? 'text-green-400' : isDown ? 'text-red-400' : 'text-slate-500';

  const amtChange  = (Number(item.current_price) || 0) - (Number(item.base_price) || 0);
  // 上昇時は符号なし、下降時のみ「-」を付ける
  const amtDisplay = amtChange < 0 ? `-${yen(Math.abs(amtChange))}` : `${yen(amtChange)}`;
  const pctDisplay = pct < 0 ? `-${num(Math.abs(pct), 1)}%` : `${num(Math.abs(pct), 1)}%`;

  return (
    <tr className={`${rowBg} border-b border-slate-700/50 transition-colors duration-700`}>
      <td className="px-4 py-3 text-slate-400 font-semibold">{item.name}</td>
      <td className="px-4 py-3 text-slate-400 text-right tabular-nums">
        ¥{yen(item.base_price)}
      </td>
      <td className="px-4 py-3 text-amber-300 font-bold text-right tabular-nums">
        ¥{yen(item.current_price)}
      </td>
      <td className={`px-4 py-3 font-bold text-right tabular-nums ${changeColor}`}>
        {amtDisplay}
      </td>
      <td className={`px-4 py-3 font-bold text-right tabular-nums ${changeColor}`}>
        {pctDisplay}
      </td>
      <td className="px-4 py-3 text-slate-400 text-right tabular-nums">
        ¥{yen(item.day_high ?? item.current_price)}
      </td>
      <td className="px-4 py-3 text-slate-400 text-right tabular-nums">
        ¥{yen(item.day_low ?? item.current_price)}
      </td>
    </tr>
  );
}
