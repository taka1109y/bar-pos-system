// 通貨・数値の安全フォーマッタ。
// null/undefined/NaN/文字列など異常値でも例外を投げず 0 系にフォールバックする。
// 価格が null の商品（時価商品など）でレンダリングがクラッシュするのを防ぐ。

export function yen(v) {
  const n = Number(v);
  return (Number.isFinite(n) ? Math.round(n) : 0).toLocaleString();
}

export function num(v, fractionDigits = 0) {
  const n = Number(v);
  return (Number.isFinite(n) ? n : 0).toFixed(fractionDigits);
}
