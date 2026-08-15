// 価格エンジンのグローバル設定値
// 商品ごとの上昇・降下額は menu_items.price_step_up / price_step_down で管理

const defaults = {
  TICK_INTERVAL_MS:     30_000,  // ティック間隔 (ms)
  WINDOW_SECONDS:       300,     // 需要計測ウィンドウ (秒)
  PRICE_STEP_DOWN:      0.04,    // 価格下降ステップ (4%/ティック、緩やかな降下に使用)
  HISTORY_KEEP:         60,      // 価格履歴の保持件数
  PRUNE_EVENTS_SECONDS: 0,       // イベントログ保持時間 (秒)。0=剪定なし（計装1-1で需要ログ永続化。従来600=10分）
};

let current = { ...defaults };

function getSettings() {
  return { ...current };
}

function updateSettings(patch) {
  const allowed = Object.keys(defaults);
  const validated = {};

  for (const key of allowed) {
    if (patch[key] === undefined) continue;
    const val = Number(patch[key]);
    // PRUNE_EVENTS_SECONDS のみ 0(=剪定なし) を許容。その他は正の数。
    const minOk = key === 'PRUNE_EVENTS_SECONDS' ? val >= 0 : val > 0;
    if (isNaN(val) || !minOk) throw new Error(`Invalid value for ${key}: must be a non-negative number`);
    validated[key] = val;
  }

  current = { ...current, ...validated };
  return { ...current };
}

function resetSettings() {
  current = { ...defaults };
  return { ...current };
}

module.exports = { getSettings, updateSettings, resetSettings, defaults };
