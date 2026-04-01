const { query } = require('../db/database');
const { broadcast } = require('./socketService');

const TICK_INTERVAL_MS = 30_000;
const WINDOW_SECONDS = 300;
const SURGE_THRESHOLD = 5;
const PRICE_STEP_UP = 0.08;
const PRICE_STEP_DOWN = 0.04;
const HISTORY_KEEP = 60;
const PRUNE_EVENTS_SECONDS = 600;

function roundToNearest(value, step) {
  return Math.round(value / step) * step;
}

async function runTick() {
  const { rows: items } = await query(`
    SELECT id, name,
      base_price::float, current_price::float,
      min_price::float, max_price::float
    FROM menu_items
    WHERE is_drink = TRUE AND is_active = TRUE
  `);

  const updates = [];

  for (const item of items) {
    const { rows: demandRows } = await query(
      `SELECT COALESCE(SUM(quantity), 0)::int AS total_qty
       FROM pricing_events
       WHERE menu_item_id = $1 AND event_time > NOW() - $2 * INTERVAL '1 second'`,
      [item.id, WINDOW_SECONDS]
    );

    const totalQty = demandRows[0].total_qty;
    const demand = totalQty / SURGE_THRESHOLD;

    let targetPrice;
    if (demand >= 1.0) {
      const surgeRatio = Math.min(demand - 1.0, 1.0);
      targetPrice = item.base_price + (item.max_price - item.base_price) * surgeRatio;
    } else {
      targetPrice = item.base_price;
    }

    let newPrice;
    if (item.current_price < targetPrice) {
      newPrice = Math.min(item.current_price * (1 + PRICE_STEP_UP), targetPrice);
    } else if (item.current_price > targetPrice) {
      newPrice = Math.max(item.current_price * (1 - PRICE_STEP_DOWN), targetPrice);
    } else {
      newPrice = item.current_price;
    }

    newPrice = Math.max(item.min_price, Math.min(item.max_price, newPrice));
    newPrice = roundToNearest(newPrice, 25);

    if (newPrice !== item.current_price) {
      await query('UPDATE menu_items SET current_price = $1 WHERE id = $2', [newPrice, item.id]);
      await query('INSERT INTO price_history (menu_item_id, price) VALUES ($1, $2)', [item.id, newPrice]);

      const pctChange = ((newPrice - item.base_price) / item.base_price) * 100;
      updates.push({
        id: item.id,
        name: item.name,
        current_price: newPrice,
        base_price: item.base_price,
        pct_change: Math.round(pctChange * 10) / 10,
        direction: newPrice > item.current_price ? 'up' : 'down',
      });

      // 古い価格履歴を削除
      await query(
        `DELETE FROM price_history
         WHERE menu_item_id = $1
           AND id NOT IN (
             SELECT id FROM price_history
             WHERE menu_item_id = $1
             ORDER BY recorded_at DESC
             LIMIT $2
           )`,
        [item.id, HISTORY_KEEP]
      );
    }
  }

  // 古いpricingイベントを削除
  await query(
    `DELETE FROM pricing_events WHERE event_time < NOW() - $1 * INTERVAL '1 second'`,
    [PRUNE_EVENTS_SECONDS]
  );

  if (updates.length > 0) {
    broadcast('prices:updated', { items: updates, timestamp: Date.now() });
    console.log(`[PricingEngine] ${updates.length} item(s) price updated`);
  }
}

function startPricingEngine() {
  console.log('[PricingEngine] Starting...');
  runTick().catch((e) => console.error('[PricingEngine] initial tick error:', e));
  setInterval(() => {
    runTick().catch((e) => console.error('[PricingEngine] tick error:', e));
  }, TICK_INTERVAL_MS);
}

module.exports = { startPricingEngine };
