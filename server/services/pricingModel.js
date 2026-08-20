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
// ★DEPRECATED(Phase7で置換)★ 以下 snapGrid/softFloor/anchorP6/maxP6/gridStepUp/gridStepDown/
//   snapClampP6/effectiveSoftFloor/stepForBase/hardFloor 群は pricing_base 中心の新格子(下部 Phase7)へ
//   置換済み。live 呼び出しは Phase7 関数へ移行済みで、本群は rollback 用に残置する(参照しないこと)。
// 凍結パラメータ(単一ソース)。base=menu_items.base_price(現行実売価格)基準。
// 呼値 step は base で決定(固定)。全約定・表示価格は base + n×step の格子点のみ。
const STEP_TABLE = [
  { maxBase: 1000, step: 30 },      // base < 1000 → 30円
  { maxBase: 3000, step: 100 },     // 1000 ≤ base < 3000 → 100円
  { maxBase: Infinity, step: 200 }, // base ≥ 3000 → 200円
];
// soft_floor_ratio(config): 通常減衰の下限率。1.0→0.8 に変更(オーナー承認)。
// soft_floor = snapGrid(base × soft_floor_ratio)。ただし原価×1.2(格子)が上回る銘柄は
// そちらへクランプ(effectiveSoftFloor)。減衰は effectiveSoftFloor(=stored min_price)で停止。
const SOFT_FLOOR_RATE = 0.8;   // soft_floor = base×0.8 (原価クランプは effectiveSoftFloor 参照)
const ANCHOR_RATE     = 1.1;   // anchor(寄り付き) = base×1.1
const MAX_RATE_P6     = 1.2;   // max = base×1.2 (=max_price)
const CRASH_FLOOR_RATIO_DEFAULT    = 0.5; // 暴落下限 = base×0.5 (通常)
const CRASH_FLOOR_RATIO_ENGINE_OFF = 0.7; // engine_off かつ crash可 の暴落下限 = base×0.7
// 運動規則の config(6-2以降で使用)
const PERIOD_MINUTES     = 15; // 1期
// 減衰カウンタ idle_periods の意味論(コード全体で統一):
// 「在店期ベースで累積2無注文期で −1段、注文で0リセット、無人期はカウンタ・価格とも凍結」。
const DECAY_IDLE_PERIODS = 2;  // −1段に必要な累積無注文期数(在店期のみ計数)
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
function softFloor(base) { return snapGrid(base, base * SOFT_FLOOR_RATE); } // = base×0.8(格子)
function anchorP6(base)  { return snapGrid(base, base * ANCHOR_RATE); }
function maxP6(base)     { return snapGrid(base, base * MAX_RATE_P6); }
// 原価床(格子)= 原価×1.2 を格子へ切上げ。原価欠損は 0。
function costFloorGrid(base, cost) { return cost > 0 ? ceilGrid(base, cost * COST_FLOOR_MULTIPLIER) : 0; }
// 実効soft_floor(=stored min_price / 減衰の停止点)。base×0.8 と 原価×1.2 の高い方。
// 原価×1.2 が上回る薄利銘柄では soft_floor が hard_floor(の原価成分)と一致し、減衰でも原価割れしない。
function effectiveSoftFloor(base, cost) { return Math.max(softFloor(base), costFloorGrid(base, cost)); }
// 暴落下限。engineOff = (engine_enabled=false かつ crash_eligible=true)。原価欠損は base×ratio のみ。
function hardFloor(base, cost, engineOff) {
  const ratio  = engineOff ? CRASH_FLOOR_RATIO_ENGINE_OFF : CRASH_FLOOR_RATIO_DEFAULT;
  const byCost = cost > 0 ? cost * COST_FLOOR_MULTIPLIER : 0;
  return ceilGrid(base, Math.max(base * ratio, byCost));
}
// 段移動(格子・[floor,max]クランプ)。floor 既定は softFloor(base) だが、減衰は stored min_price
// (=effectiveSoftFloor)を渡して原価クランプを尊重する。
function gridStepUp(base, price)          { return Math.min(maxP6(base), snapGrid(base, price + stepForBase(base))); }
function gridStepDown(base, price, floor) {
  const lo = floor != null ? floor : softFloor(base);
  return Math.max(lo, snapGrid(base, price - stepForBase(base)));
}
// 現在価格を新格子へスナップし[soft,max]にクランプ(移行用)
function snapClampP6(base, price)  { return Math.max(softFloor(base), Math.min(maxP6(base), snapGrid(base, price))); }

// ── Phase7: pricing_base 中心 21点格子 ＋ カテゴリ内ゼロサム・シーソー ──────────────
// 現行実売価格 base_price は不変。pricing_base = round_to_unit(base×1.10) を帯の中心とし、
// 価格 = pricing_base + n×step（n∈[-10,+10] の21点のみ）。step = round_to_unit(pricing_base×0.02)。
// 丸め単位は base で決定: base<1000→10 / <3000→50 / ≥3000→100（step も同単位・最低 unit）。
// engine_off/固定/時価は markup 非適用＝常に定価(base)。markup は engine_on 変動ドリンクの帯中心にのみ効く。
const BASE_MARKUP    = 1.10;   // pricing_base = base × 1.10（帯中心＝旧 anchor 概念を統合）
const GRID_HALF_SPAN = 10;     // n∈[-10,+10] の21点
const STEP_RATE      = 0.02;   // step = pricing_base × 2%（帯 = ±10step = ±約20%）
const STEP_UNIT      = 10;     // step の丸め単位(Phase7R2でオーナー承認 ¥5→¥10)。2%を¥10単位で切り下げ。
                               // ※floor切下げにより 10step≤pricing_base×0.02×10=±20% は保たれるが、pricing_base<500(=最小¥10がpb×2%を上回る)の
                               //   低価格銘柄のみ ±20%を超え得る(可動域比率は移行レポートで列挙)。丸め単位テーブル(unitForBase)は現行維持。
const MARKUP_UNIT_TABLE = [
  { maxBase: 1000, unit: 10 },      // base<1000 → 10円
  { maxBase: 3000, unit: 50 },      // 1000≤base<3000 → 50円
  { maxBase: Infinity, unit: 100 }, // base≥3000 → 100円
];
// シーソー段数抽選（勝者の上昇段。犠牲はこの上昇分をカテゴリ内へ -1 ずつ配分＝ゼロサム）。
// sum=1 を起動時に検証（誤設定で確率が崩れるのを防ぐ）。
const SEESAW_DIST = [
  { steps: 1, p: 0.6 },
  { steps: 2, p: 0.3 },
  { steps: 3, p: 0.1 },
];
(function assertSeesawDist() {
  const sum = SEESAW_DIST.reduce((s, d) => s + d.p, 0);
  if (Math.abs(sum - 1) > 1e-9) throw new Error(`SEESAW_DIST の確率合計が1ではない: ${sum}`);
})();

// 丸め単位（base で決定）
function unitForBase(base) {
  for (const t of MARKUP_UNIT_TABLE) if (base < t.maxBase) return t.unit;
  return MARKUP_UNIT_TABLE[MARKUP_UNIT_TABLE.length - 1].unit;
}
// 単位丸め（round half up）
function roundToUnit(x, unit) { return Math.floor(x / unit + 0.5) * unit; }
// pricing_base = round_to_unit(base × 1.10)
function pricingBase(base) { return roundToUnit(base * BASE_MARKUP, unitForBase(base)); }
// step = pricing_base×2% を STEP_UNIT(¥5)単位で切り下げ（min STEP_UNIT）。
// 切り下げにより 10step ≤ 20%×pricing_base が保証され、帯は必ず±20%以内に収まる。
function gridStep(base) {
  const raw = pricingBase(base) * STEP_RATE;
  return Math.max(STEP_UNIT, Math.floor(raw / STEP_UNIT) * STEP_UNIT);
}
// n をクランプ [-10,+10]
function clampN(n) { return Math.max(-GRID_HALF_SPAN, Math.min(GRID_HALF_SPAN, n)); }
// 価格 = pricing_base + n×step（n はクランプ）
function priceAtN(base, n) { return pricingBase(base) + clampN(n) * gridStep(base); }
// 価格 → n（最寄り・クランプ）
function nForPrice(base, price) {
  const step = gridStep(base);
  if (step <= 0) return 0;
  return clampN(Math.round((price - pricingBase(base)) / step));
}
function floorPrice(base)   { return priceAtN(base, -GRID_HALF_SPAN); } // n=-10 = pricing_base-10step（純格子下限≒-20%）
function ceilingPrice(base) { return priceAtN(base, +GRID_HALF_SPAN); } // n=+10 = pricing_base+10step（≒+20%）
// 価格を格子(pricing_base + n×step)へ上スナップ
function snapUpToGrid(base, price) {
  const pb = pricingBase(base), step = gridStep(base);
  return pb + Math.ceil((price - pb) / step) * step;
}
// 原価床(格子)= 原価×1.2 を格子へ上スナップ。原価欠損は 0。
function costFloorGridNew(base, cost) { return cost > 0 ? snapUpToGrid(base, cost * COST_FLOOR_MULTIPLIER) : 0; }
// 実効 floor = max(格子下限 floorPrice(n=-10), 原価×1.2格子)。原価が厳しい銘柄は floor が原価で持ち上がる。
// これが stored min_price / シーソー犠牲の下限 を兼ねる（旧 ×0.5/×0.7 は base基準として廃止）。
// ※Phase7R: 暴落床は effectiveFloor と分離し crashFloor(pricing_base×比率) を使う（このeffectiveFloorは暴落床を兼ねない）。
function effectiveFloor(base, cost) { return Math.max(floorPrice(base), costFloorGridNew(base, cost)); }
// 暴落床(Phase7R・動的算出)= round_to_unit(max(原価×1.2, pricing_base×ratio))。ratio は crashSettings（default=0.5 / engine_off=0.7）。
// 通常下限(effectiveFloor)とは別物＝暴落は pricing_base×比率まで深く落とす（床を分離）。原価欠損(cost<=0)は pricing_base×ratio のみ（呼出側が警告）。
function crashFloor(base, cost, ratio) {
  const byRatio = pricingBase(base) * ratio;
  const byCost  = cost > 0 ? cost * COST_FLOOR_MULTIPLIER : 0;
  return roundToUnit(Math.max(byRatio, byCost), unitForBase(base));
}
// 格子点判定（検証用・ランタイムには挿さない）
function onGridNew(base, price) {
  const step = gridStep(base);
  return step > 0 && Number.isInteger((price - pricingBase(base)) / step);
}
// シーソー確率のランタイム上書き（管理画面から編集可能）。null=既定 SEESAW_DIST を使用。
// ※確率のみ可変（上昇段の値 1/2/3 は固定）。stored 価格には影響しない（次の注文から反映）。
let runtimeSeesawDist = null;
function getSeesawDist() { return runtimeSeesawDist || SEESAW_DIST; }
// dist = [{steps, p}...]。sum(p)=1・p>=0・steps>=1 を検証して上書き。
function setSeesawDist(dist) {
  if (!Array.isArray(dist) || dist.length === 0) throw new Error('seesaw_dist は非空の配列が必要');
  const norm = dist.map((d) => ({ steps: Number(d.steps), p: Number(d.p) }));
  if (norm.some((d) => !Number.isInteger(d.steps) || d.steps < 1 || !Number.isFinite(d.p) || d.p < 0)) {
    throw new Error('seesaw_dist の各要素は steps(整数>=1)・p(>=0) が必要');
  }
  const sum = norm.reduce((s, d) => s + d.p, 0);
  if (Math.abs(sum - 1) > 1e-6) throw new Error(`seesaw_dist の確率合計が1ではない: ${sum}`);
  runtimeSeesawDist = norm;
  return runtimeSeesawDist;
}
// シーソー: 勝者の上昇段を抽選（rng は [0,1) を返す関数）。cumulative 方式。実行時の確率を参照。
function drawSeesawSteps(rng) {
  const dist = getSeesawDist();
  const r = rng();
  let acc = 0;
  for (const d of dist) { acc += d.p; if (r < acc) return d.steps; }
  return dist[dist.length - 1].steps;
}

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
  softFloor, costFloorGrid, effectiveSoftFloor, anchorP6, maxP6, hardFloor, gridStepUp, gridStepDown, snapClampP6,
  // Phase7 pricing_base 中心格子＋シーソー
  BASE_MARKUP, GRID_HALF_SPAN, STEP_RATE, STEP_UNIT, MARKUP_UNIT_TABLE, SEESAW_DIST,
  unitForBase, roundToUnit, pricingBase, gridStep, clampN, priceAtN, nForPrice,
  floorPrice, ceilingPrice, snapUpToGrid, costFloorGridNew, effectiveFloor, crashFloor, onGridNew,
  drawSeesawSteps, getSeesawDist, setSeesawDist,
};
