const express = require('express');
const router = express.Router();
const pricingSettings = require('../services/pricingSettings');
const { restartInterval } = require('../services/pricingEngine');

// GET /api/settings/pricing — 現在の設定値を返す
router.get('/pricing', (req, res) => {
  res.json({
    settings: pricingSettings.getSettings(),
    defaults: pricingSettings.defaults,
  });
});

// PATCH /api/settings/pricing — 設定値を更新
router.patch('/pricing', (req, res) => {
  try {
    const updated = pricingSettings.updateSettings(req.body);
    // TICK_INTERVAL_MS が含まれる場合はインターバルを再起動
    if (req.body.TICK_INTERVAL_MS !== undefined) {
      restartInterval();
    }
    res.json({ settings: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/settings/pricing/reset — デフォルトに戻す
router.post('/pricing/reset', (req, res) => {
  const reset = pricingSettings.resetSettings();
  restartInterval();
  res.json({ settings: reset });
});

module.exports = router;
