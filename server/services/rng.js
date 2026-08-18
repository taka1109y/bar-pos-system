// シード可能な疑似乱数（PRNG）。価格モデルのシーソー抽選で使用する。
// サーバに Math.random を持ち込まず、テストは固定シードで完全再現、本番は日々異なるシードで運用する。
// 実装は定番の xmur3(seed生成) → mulberry32(本体)。いずれも 32bit 整数演算・依存なし。

// 文字列シード → 32bit ハッシュ生成器（mulberry32 の初期 seed を作る）
function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

// 32bit seed → [0,1) を返す PRNG
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 文字列シードから [0,1) を返す PRNG を生成する。同一シード → 同一列（再現可能）。
function makeRng(seedStr) {
  const seedFn = xmur3(String(seedStr));
  return mulberry32(seedFn());
}

module.exports = { xmur3, mulberry32, makeRng };
