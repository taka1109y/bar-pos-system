// 手動暴落（暴落ナイト用）のパラメータ集約。マジックナンバーの散在を避けるためここに集約する。
// v1は定数。将来 system_settings 経由で調整可能にする余地を残す。
module.exports = {
  // 目標下落: 基準価格(base_price)× この率 まで下げる（下限は下記セーフティネットが優先）
  MANUAL_CRASH_TARGET_RATE: 0.5,
  // 継続時間（ミリ秒）。経過後サーバが自動解除する
  MANUAL_CRASH_DURATION_MS: 5 * 60 * 1000,
  // Phase7R: 暴落床の比率（config復活）。crash_floor = round_to_unit(max(原価×1.2, pricing_base×ratio))。
  // 通常下限(effectiveFloor=stored min_price)とは分離し、暴落は pricing_base×比率まで深く落とす。
  // engine_on の変動ドリンク=0.5（深く）／engine_off かつ暴落可(高額グラス等)=0.7（浅め）。
  CRASH_FLOOR_RATIO_DEFAULT: 0.5,
  CRASH_FLOOR_RATIO_ENGINE_OFF: 0.7,
  // セーフティネット（絶対床・優先）: 原価がある商品は 原価×この倍率、無い商品は base×フォールバック率
  COST_FLOOR_MULTIPLIER: 1.2,
  NO_COST_FLOOR_RATE: 0.4,
  // 価格の丸め単位（円）
  PRICE_ROUND_UNIT: 25,
};
