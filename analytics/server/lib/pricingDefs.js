'use strict';
// POS 本体（server/services/pricingModel.js）と同一の価格モデル定義を参照する（lib/posDefs.js と同じ流儀）
// - 呼値（1段の値幅）＝ pm.gridStep(base) は Phase7 の凍結パラメータ（pricing_base×2% を ¥10 単位で切り下げ）。
//   分析側で段数を数え直すために同じ関数を使う（定義が二重にならないようにする）。
// - 暴落の既定継続時間（CRASH_MINUTES）は crash_reset が記録されていない区間の終了時刻の推定に使う。
// - pricingModel.js は純関数の集合で DB にも socket にも触らないため、読み取り専用の分析サーバから require して問題ない。
const path = require('path');

const MODEL_PATH = path.resolve(__dirname, '..', '..', '..', 'server', 'services', 'pricingModel.js');
const pm = require(MODEL_PATH);

const REQUIRED = ['gridStep', 'pricingBase', 'unitForBase', 'CRASH_MINUTES', 'BASE_MARKUP', 'STEP_RATE'];
const missing = REQUIRED.filter((k) => pm[k] === undefined);
if (missing.length > 0) {
  throw new Error(
    `server/services/pricingModel.js の export が想定と違います（未定義: ${missing.join(', ')}）。` +
    'Phase7 価格モデルの関数名が変わった場合は analytics/server/lib/pricingDefs.js を追随させてください'
  );
}

// 呼値（1段の値幅・円）。base が 0/NULL の時価商品は段数を定義できないので null
function stepFor(base) {
  const b = Number(base);
  if (!Number.isFinite(b) || b <= 0) return null;
  const step = pm.gridStep(b);
  return Number.isFinite(step) && step > 0 ? step : null;
}

// 価格差（円）→ 段数（四捨五入・絶対値）。呼値が定義できない商品は null
function stepsOf(base, delta) {
  const step = stepFor(base);
  if (step == null) return null;
  const d = Number(delta);
  if (!Number.isFinite(d)) return null;
  return Math.round(Math.abs(d) / step);
}

module.exports = {
  pm,
  stepFor,
  stepsOf,
  CRASH_MINUTES: pm.CRASH_MINUTES,
  BASE_MARKUP: pm.BASE_MARKUP,
  STEP_RATE: pm.STEP_RATE,
};
