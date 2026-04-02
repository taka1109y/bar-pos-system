const { query } = require('../db/database');
const { broadcast } = require('./socketService');
const pricingSettings = require('./pricingSettings');

function roundToNearest(value, step) {
  return Math.round(value / step) * step;
}

async function runTick() {
  const {
    WINDOW_SECONDS,
    PRICE_STEP_DOWN,
    HISTORY_KEEP,
    PRUNE_EVENTS_SECONDS,
  } = pricingSettings.getSettings();

  // サブカテゴリ別アクティブドリンク数
  const { rows: subcatCountRows } = await query(`
    SELECT subcategory_id, COUNT(*)::int AS cnt
    FROM menu_items
    WHERE is_drink = TRUE AND is_active = TRUE AND subcategory_id IS NOT NULL
    GROUP BY subcategory_id
  `);
  const subcatCountMap = Object.fromEntries(
    subcatCountRows.map((r) => [r.subcategory_id, r.cnt])
  );

  const { rows: items } = await query(`
    SELECT id, name, subcategory_id,
      base_price::float, current_price::float,
      min_price::float, max_price::float,
      price_step_up::float, price_step_down::float
    FROM menu_items
    WHERE is_drink = TRUE AND is_active = TRUE
  `);

  const { rows: demandRows } = await query(
    `SELECT menu_item_id, COALESCE(SUM(quantity), 0)::int AS total_qty
     FROM pricing_events
     WHERE event_time > NOW() - $1 * INTERVAL '1 second'
     GROUP BY menu_item_id`,
    [WINDOW_SECONDS]
  );
  const demandMap = Object.fromEntries(demandRows.map((r) => [r.menu_item_id, r.total_qty]));

  // サブカテゴリ別の合計需要
  const subcatDemandMap = {};
  for (const item of items) {
    if (item.subcategory_id != null) {
      const qty = demandMap[item.id] ?? 0;
      subcatDemandMap[item.subcategory_id] = (subcatDemandMap[item.subcategory_id] ?? 0) + qty;
    }
  }

  const updates = [];

  for (const item of items) {
    const itemQty = demandMap[item.id] ?? 0;

    let targetPrice;

    if (item.subcategory_id != null) {
      const subcatItemCount = subcatCountMap[item.subcategory_id] ?? 0;

      if (subcatItemCount <= 1) {
        // 1商品サブカテゴリ: base_price へ緩やかに戻す
        targetPrice = item.base_price;
      } else {
        // 競合ロジック: 自分の注文数 × step_up、競合注文数 × step_down
        const competitorQty = (subcatDemandMap[item.subcategory_id] ?? 0) - itemQty;
        targetPrice = item.base_price
          + itemQty       * item.price_step_up
          - competitorQty * item.price_step_down;
        targetPrice = Math.max(item.min_price, Math.min(item.max_price, targetPrice));
      }
    } else {
      // サブカテゴリなし: 自分の注文数 × step_up のみ
      targetPrice = item.base_price + itemQty * item.price_step_up;
      targetPrice = Math.max(item.min_price, Math.min(item.max_price, targetPrice));
    }

    let newPrice;
    if (item.current_price < targetPrice) {
      newPrice = targetPrice; // 即時引き上げ
    } else if (item.current_price > targetPrice) {
      newPrice = Math.max(item.current_price * (1 - PRICE_STEP_DOWN), targetPrice); // 緩やかに下降
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

      await query(
        `DELETE FROM price_history
         WHERE menu_item_id = $1
           AND id NOT IN (
             SELECT id FROM price_history WHERE menu_item_id = $1
             ORDER BY recorded_at DESC LIMIT $2
           )`,
        [item.id, HISTORY_KEEP]
      );
    }
  }

  await query(
    `DELETE FROM pricing_events WHERE event_time < NOW() - $1 * INTERVAL '1 second'`,
    [PRUNE_EVENTS_SECONDS]
  );

  if (updates.length > 0) {
    broadcast('prices:updated', { items: updates, timestamp: Date.now() });
    console.log(`[PricingEngine] ${updates.length} item(s) price updated`);
  }

  // 全アイテムの最新価格をブロードキャスト
  const { rows: allPrices } = await query(`
    SELECT id, name,
      base_price::float, current_price::float,
      ROUND((current_price - base_price) * 100.0 / base_price, 1)::float AS pct_change
    FROM menu_items
    WHERE is_drink = TRUE AND is_active = TRUE
  `);
  const syncItems = allPrices.map((r) => ({
    ...r,
    direction: r.pct_change > 0 ? 'up' : r.pct_change < 0 ? 'down' : 'flat',
  }));
  broadcast('prices:sync', { items: syncItems, timestamp: Date.now() });
}

let running     = false;
let pendingTick = false;

async function triggerTick() {
  if (running) { pendingTick = true; return; }
  running = true;
  try {
    await runTick();
    if (pendingTick) { pendingTick = false; await runTick(); }
  } catch (e) {
    console.error('[PricingEngine] triggered tick error:', e);
  } finally {
    running = false; pendingTick = false;
  }
}

let tickTimer = null;

function startPricingEngine() {
  const { TICK_INTERVAL_MS } = pricingSettings.getSettings();
  console.log('[PricingEngine] Starting...');
  runTick().catch((e) => console.error('[PricingEngine] initial tick error:', e));
  tickTimer = setInterval(() => {
    runTick().catch((e) => console.error('[PricingEngine] tick error:', e));
  }, TICK_INTERVAL_MS);
}

function restartInterval() {
  if (tickTimer) clearInterval(tickTimer);
  const { TICK_INTERVAL_MS } = pricingSettings.getSettings();
  tickTimer = setInterval(() => {
    runTick().catch((e) => console.error('[PricingEngine] tick error:', e));
  }, TICK_INTERVAL_MS);
  console.log(`[PricingEngine] Interval restarted: ${TICK_INTERVAL_MS}ms`);
}

module.exports = { startPricingEngine, triggerTick, restartInterval };
