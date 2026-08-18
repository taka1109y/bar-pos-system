const express = require('express');
const router = express.Router();
const { query } = require('../db/database');
const pricingSettings = require('../services/pricingSettings');

// pricingSettings のキー名 <-> system_settings に保存する際のキー名の対応
// Phase7: 時間減衰・期タイマー廃止に伴い TICK_INTERVAL_MS/WINDOW_SECONDS/PRICE_STEP_DOWN は撤去。
const DB_KEY_MAP = {
  HISTORY_KEEP:         'pricing_history_keep',
  PRUNE_EVENTS_SECONDS: 'pricing_prune_events_seconds',
};

const upsertSetting = (key, value) =>
  query(
    `INSERT INTO system_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, String(value)]
  );

// サーバー起動時に呼び出し、DBに保存済みの価格エンジン設定を読み込んで反映する
async function loadPersistedPricingSettings() {
  const { rows } = await query(
    `SELECT key, value FROM system_settings WHERE key = ANY($1)`,
    [Object.values(DB_KEY_MAP)]
  );
  if (rows.length === 0) return;

  const dbKeyToSettingKey = Object.fromEntries(
    Object.entries(DB_KEY_MAP).map(([settingKey, dbKey]) => [dbKey, settingKey])
  );
  const patch = {};
  for (const row of rows) {
    const settingKey = dbKeyToSettingKey[row.key];
    if (settingKey) patch[settingKey] = row.value;
  }
  pricingSettings.updateSettings(patch);
}

// GET /api/settings/pricing — 現在の設定値を返す
router.get('/pricing', (req, res) => {
  res.json({
    settings: pricingSettings.getSettings(),
    defaults: pricingSettings.defaults,
  });
});

// PATCH /api/settings/pricing — 設定値を更新
router.patch('/pricing', async (req, res, next) => {
  try {
    const updated = pricingSettings.updateSettings(req.body);

    // サーバー再起動後も値が消えないよう、変更されたキーをDBにも保存する
    for (const settingKey of Object.keys(DB_KEY_MAP)) {
      if (req.body[settingKey] === undefined) continue;
      await upsertSetting(DB_KEY_MAP[settingKey], updated[settingKey]);
    }

    res.json({ settings: updated });
  } catch (err) {
    if (err.message?.startsWith('Invalid value')) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

// POST /api/settings/pricing/reset — デフォルトに戻す
router.post('/pricing/reset', async (req, res, next) => {
  try {
    await query(
      `DELETE FROM system_settings WHERE key = ANY($1)`,
      [Object.values(DB_KEY_MAP)]
    );
    const reset = pricingSettings.resetSettings();
    res.json({ settings: reset });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.loadPersistedPricingSettings = loadPersistedPricingSettings;
