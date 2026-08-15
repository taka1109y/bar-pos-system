// 価格モデル(Phase4): 呼値ラダー方式の純関数と定数。すべて円(整数, 25円倍数)で計算する。
// 浮動小数バグを避けるため、価格に関わる演算はここに集約しテスト可能にする。

const UNIT = 25;                 // 呼値の最小単位(円)
const LADDER_STEPS = 12;         // min〜max を刻む段数(目安)
const PERIOD_MS = 15 * 60 * 1000; // 1期(減衰の区切り)
const MIN_RATE = 0.5;            // min の基準率(base×0.5 と原価床の高い方)
const MAX_RATE_MIN = 1.2;        // max の最小率
const MAX_RATE_SPAN = 0.1;       // max = base×(1.2 + 0.1×利益率)
const COST_FLOOR_MULTIPLIER = 1.2; // 原価床 = 原価×1.2
const NO_COST_FLOOR_RATE = 0.4;    // 原価不明時の床 = base×0.4

const round25 = (v) => Math.round(v / UNIT) * UNIT;
const ceil25  = (v) => Math.ceil(v / UNIT) * UNIT;

// 利益率 margin = clamp(1 - cost/base, 0, 1)
function margin(base, cost) {
  if (!(base > 0)) return 0;
  return Math.max(0, Math.min(1, 1 - (cost > 0 ? cost / base : 0)));
}

// 原価割れ防止の絶対床（原価×1.2 / 原価なしは base×0.4、25円切上げ）
function costFloor(base, cost) {
  return cost > 0 ? ceil25(cost * COST_FLOOR_MULTIPLIER) : ceil25(base * NO_COST_FLOOR_RATE);
}

// 商品ごとの min / max（整数・25円倍数）。min は必ず原価床以上。
function computeMin(base, cost) {
  return Math.max(round25(base * MIN_RATE), costFloor(base, cost));
}
function computeMax(base, cost) {
  return round25(base * (MAX_RATE_MIN + MAX_RATE_SPAN * margin(base, cost)));
}

// 段幅(呼値)。(max-min)/段数 を25円単位、最低25円。
function ladderStep(min, max) {
  return Math.max(UNIT, round25((max - min) / LADDER_STEPS));
}

// 価格→段インデックス（最寄り段）
function levelIndex(price, min, max, step) {
  const c = Math.max(min, Math.min(max, price));
  if (step <= 0) return 0;
  return Math.round((c - min) / step);
}
// 段インデックス→価格（max頭打ち・整数）
function levelPrice(idx, min, max, step) {
  const p = min + Math.max(0, idx) * step;
  return Math.min(max, p);
}
// 最寄りのラダー段にスナップ
function snapToLadder(price, min, max, step) {
  if (max <= min) return min;
  return levelPrice(levelIndex(price, min, max, step), min, max, step);
}
// 1段上げ / 1段下げ（境界は頭打ち）
function stepUp(price, min, max, step) {
  if (max <= min) return min;
  return levelPrice(levelIndex(price, min, max, step) + 1, min, max, step);
}
function stepDown(price, min, max, step) {
  if (max <= min) return min;
  return Math.max(min, levelPrice(Math.max(0, levelIndex(price, min, max, step) - 1), min, max, step));
}

module.exports = {
  UNIT, LADDER_STEPS, PERIOD_MS, MIN_RATE, MAX_RATE_MIN, MAX_RATE_SPAN,
  COST_FLOOR_MULTIPLIER, NO_COST_FLOOR_RATE,
  round25, ceil25, margin, costFloor, computeMin, computeMax, ladderStep,
  levelIndex, levelPrice, snapToLadder, stepUp, stepDown,
};
