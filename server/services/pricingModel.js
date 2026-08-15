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

// ── Phase6: 価格格子(呼値ラダー)モデル ─────────────────────────────
// 凍結パラメータ(単一ソース)。base=menu_items.base_price(現行実売価格)基準。
// 呼値 step は base で決定(固定)。全約定・表示価格は base + n×step の格子点のみ。
const STEP_TABLE = [
  { maxBase: 1000, step: 30 },      // base < 1000 → 30円
  { maxBase: 3000, step: 100 },     // 1000 ≤ base < 3000 → 100円
  { maxBase: Infinity, step: 200 }, // base ≥ 3000 → 200円
];
const SOFT_FLOOR_RATE = 1.0;   // soft_floor = base×1.0 (通常時の下限, =min_price)
const ANCHOR_RATE     = 1.1;   // anchor(寄り付き) = base×1.1
const MAX_RATE_P6     = 1.2;   // max = base×1.2 (=max_price)
const CRASH_FLOOR_RATIO_DEFAULT    = 0.5; // 暴落下限 = base×0.5 (通常)
const CRASH_FLOOR_RATIO_ENGINE_OFF = 0.7; // engine_off かつ crash可 の暴落下限 = base×0.7
// 運動規則の config(6-2以降で使用)
const PERIOD_MINUTES     = 15; // 1期
const DECAY_IDLE_PERIODS = 2;  // 2期連続(在店・無注文)で −1段
const CRASH_MINUTES      = 5;  // 暴落継続時間
// COST_FLOOR_MULTIPLIER(=1.2) は既存定数を流用

// 中間値は切り上げ(round half up)。格子タイブレークを検算表と一致させる。
function roundHalfUp(x) { return Math.floor(x + 0.5); }

// 呼値: base で決定(固定)
function stepForBase(base) {
  for (const t of STEP_TABLE) if (base < t.maxBase) return t.step;
  return STEP_TABLE[STEP_TABLE.length - 1].step;
}
// 格子スナップ: base + n×step の最寄り格子点(中間切り上げ)
function snapGrid(base, price) {
  const step = stepForBase(base);
  return base + roundHalfUp((price - base) / step) * step;
}
// 格子への切り上げ
function ceilGrid(base, price) {
  const step = stepForBase(base);
  return base + Math.ceil((price - base) / step) * step;
}
function softFloor(base) { return snapGrid(base, base * SOFT_FLOOR_RATE); } // = base
function anchorP6(base)  { return snapGrid(base, base * ANCHOR_RATE); }
function maxP6(base)     { return snapGrid(base, base * MAX_RATE_P6); }
// 暴落下限。engineOff = (engine_enabled=false かつ crash_eligible=true)。原価欠損は base×ratio のみ。
function hardFloor(base, cost, engineOff) {
  const ratio  = engineOff ? CRASH_FLOOR_RATIO_ENGINE_OFF : CRASH_FLOOR_RATIO_DEFAULT;
  const byCost = cost > 0 ? cost * COST_FLOOR_MULTIPLIER : 0;
  return ceilGrid(base, Math.max(base * ratio, byCost));
}
// 段移動(格子・[soft,max]クランプ)
function gridStepUp(base, price)   { return Math.min(maxP6(base),   snapGrid(base, price + stepForBase(base))); }
function gridStepDown(base, price) { return Math.max(softFloor(base), snapGrid(base, price - stepForBase(base))); }
// 現在価格を新格子へスナップし[soft,max]にクランプ(移行用)
function snapClampP6(base, price)  { return Math.max(softFloor(base), Math.min(maxP6(base), snapGrid(base, price))); }

module.exports = {
  UNIT, LADDER_STEPS, PERIOD_MS, MIN_RATE, MAX_RATE_MIN, MAX_RATE_SPAN,
  COST_FLOOR_MULTIPLIER, NO_COST_FLOOR_RATE,
  round25, ceil25, margin, costFloor, computeMin, computeMax, ladderStep,
  levelIndex, levelPrice, snapToLadder, stepUp, stepDown,
  // Phase6 価格格子
  STEP_TABLE, SOFT_FLOOR_RATE, ANCHOR_RATE, MAX_RATE_P6,
  CRASH_FLOOR_RATIO_DEFAULT, CRASH_FLOOR_RATIO_ENGINE_OFF,
  PERIOD_MINUTES, DECAY_IDLE_PERIODS, CRASH_MINUTES,
  roundHalfUp, stepForBase, snapGrid, ceilGrid,
  softFloor, anchorP6, maxP6, hardFloor, gridStepUp, gridStepDown, snapClampP6,
};
