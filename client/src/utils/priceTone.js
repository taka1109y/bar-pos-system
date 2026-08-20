// 価格の色/矢印(▲▼)は「本日の寄り付き価格(pricing_base=中心)比」で決める。
// ※定価(base_price)比ではない。定価や×1.1 の関係は客側UIに一切出さない。
// engine_off・ノンアル・時価・フード・ロック品(variable=false)は常に無色。暴落中は 'crash' で上書き。
//
// live = usePriceStore のエントリ(サーバが付与した n / center_pct / variable / is_crashed / seesaw を含む)
export function priceDisplay(live) {
  const crashed = !!live?.is_crashed;
  const variable = !!live?.variable;
  const n = Number(live?.n ?? 0);
  const centerPct = Number(live?.center_pct ?? 0);
  // tone: 'crash'(暴落・最優先) / 'none'(変動対象外=無色) / 'up' / 'down' / 'flat'(中心=無色)
  const tone = crashed ? 'crash' : !variable ? 'none' : n > 0 ? 'up' : n < 0 ? 'down' : 'flat';
  return { crashed, variable, n, centerPct, tone, seesaw: live?.seesaw ?? null };
}

// 中心比の矢印記号。up=▲ / down=▼ / それ以外=空。
export function toneArrow(tone) {
  return tone === 'up' ? '▲' : tone === 'down' ? '▼' : '';
}

// 「▲2.4%」形式(寄り付き比%)。up/down のときのみ。
export function centerPctLabel(tone, centerPct) {
  if (tone !== 'up' && tone !== 'down') return '';
  return `${toneArrow(tone)}${Math.abs(centerPct).toFixed(1)}%`;
}

// 凡例の共通文言(表示付近に常設)
export const PRICE_LEGEND = '▲▼は本日の寄り付き価格との比較';
