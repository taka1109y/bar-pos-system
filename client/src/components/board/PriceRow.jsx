import { useEffect, useRef, useState } from 'react';
import { yen, num } from '../../utils/format';
import { priceDisplay, toneArrow } from '../../utils/priceTone';
import BoardSparkline from './BoardSparkline';

// 価格ボード(取引所ビッグボード)の1行。
// 色/▲▼は「寄り付き価格(pricing_base=中心)比」。定価(base_price)は板に出さない。
// 列: 商品名(+段数バッジ) / スパークライン / 基準値(寄り付き) / 現在値 / 変動幅(%)
export default function PriceRow({ item, zebra = false }) {
  const disp     = priceDisplay(item);
  const crashed  = disp.tone === 'crash';
  const isUp     = disp.tone === 'up';
  const isDown   = disp.tone === 'down';
  const variable = disp.variable;

  const changeColor = crashed
    ? 'text-red-300'
    : isUp ? 'text-[#1fe08a]' : isDown ? 'text-[#ff415e]' : 'text-slate-500';

  // 時価(price_editable / base_price 0・null)は金額を出さず「時価」表示
  const isJika   = !item.base_price;
  const curPrice = Math.max(0, Number(item.current_price) || 0); // 負値ガード
  const center   = Number(item.pricing_base) || 0;               // 本日の寄り付き価格(=基準値)

  // 価格が変動しない商品(engine_off／時価／固定=variable無)かつ暴落中でない=「価格のみ表示」。
  // スパークライン・基準値・変動幅%・同日高値/底値は出さず、現在値(時価品は「時価」)だけ表示する。
  // ※暴落中(crashed)は variable=false でも従来どおり赤演出・情報を出す(対象外)。
  const priceOnly = !variable && !crashed;

  // 変動幅%は寄り付き比。変動対象のみ表示、それ以外は「—」。
  const centerPct  = Number(item.center_pct) || 0;
  const pctDisplay = variable
    ? (isUp || isDown ? `${toneArrow(disp.tone)}${num(Math.abs(centerPct), 1)}%` : '0.0%')
    : '—';
  // 基準値セル: 価格のみ表示商品=空欄 / それ以外=寄り付き価格
  const baseCell = priceOnly ? '—' : `¥${yen(center)}`;

  // 段数バッジ(▲k)。連続注文で累積した delta を usePriceStore が保持する。
  const seesaw = disp.seesaw;
  const seesawWin = seesaw?.event === 'seesaw_win';
  const seesawDelta = Number(seesaw?.delta) || 0;

  // 価格変化時に対象「行」を1回だけフラッシュ(緑=上昇/赤=下降)。key を変えて毎回リスタート。
  const prevPrice = useRef(curPrice);
  const [flashDir, setFlashDir] = useState('');
  const [flashKey, setFlashKey] = useState(0);
  useEffect(() => {
    const prev = Number(prevPrice.current) || 0;
    if (curPrice !== prev) {
      setFlashDir(curPrice > prev ? 'board-flash-up' : 'board-flash-down');
      setFlashKey((k) => k + 1);
      prevPrice.current = curPrice;
    }
  }, [curPrice]);

  // 通常行は持続的な色付けをしないが、奇数/偶数のゼブラ背景で視認性を上げる。
  // 暴落中は赤背景を優先。価格変化時の1回フラッシュはゼブラ背景の上から一時的に発火。
  const zebraBg = zebra ? 'bg-white/[0.035]' : '';
  const rowBase = crashed
    ? 'bg-[#2a0d14] board-crash-row'
    : `${zebraBg} ${flashDir}`;

  return (
    <tr key={flashKey} className={`border-b border-slate-700/40 ${rowBase}`}>
      {/* 商品名 + 段数バッジ */}
      <td className="px-4 py-3 text-slate-200 font-medium text-[1.375rem] whitespace-nowrap overflow-hidden text-ellipsis">
        <span className="align-middle">{item.name}</span>
        {seesaw && variable && (
          <span
            key={`${seesaw.event}-${seesawDelta}`}
            className={`board-delta board-display ml-2 inline-block align-middle text-lg font-bold leading-none px-2 py-0.5 rounded ${
              seesawWin ? 'text-[#1fe08a] bg-[#1fe08a]/15' : 'text-[#ff415e] bg-[#ff415e]/15'
            }`}
          >
            {seesawWin ? '▲' : '▼'}{seesawDelta}
          </span>
        )}
      </td>

      {/* スパークライン（価格のみ表示商品は非表示） */}
      <td className="px-4 py-2">
        {priceOnly ? <div style={{ height: 36 }} /> : (
          <BoardSparkline itemId={item.id} basePrice={curPrice} tone={disp.tone} />
        )}
      </td>

      {/* 基準値(寄り付き) */}
      <td className="px-4 py-3 text-slate-500 text-right tabular-nums text-lg">{baseCell}</td>

      {/* 現在値 */}
      <td className="px-4 py-3 text-[#ffd36b] font-semibold text-right tabular-nums text-[2.125rem]">
        {isJika ? '時価' : `¥${yen(curPrice)}`}
      </td>

      {/* 変動幅(%) */}
      <td className={`px-4 py-3 font-semibold text-right tabular-nums text-[1.375rem] ${changeColor}`}>
        {pctDisplay}
      </td>

      {/* 同日高値（レジオープン以降の最高値・価格のみ表示商品は空欄） */}
      <td className="px-4 py-3 text-slate-400 text-right tabular-nums text-lg">
        {priceOnly ? '—' : `¥${yen(item.day_high ?? curPrice)}`}
      </td>

      {/* 同日底値（レジオープン以降の最安値・価格のみ表示商品は空欄） */}
      <td className="px-4 py-3 text-slate-400 text-right tabular-nums text-lg">
        {priceOnly ? '—' : `¥${yen(item.day_low ?? curPrice)}`}
      </td>
    </tr>
  );
}
