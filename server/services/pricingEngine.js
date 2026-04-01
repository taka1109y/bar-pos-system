const { query } = require('../db/database');
const { broadcast } = require('./socketService');

const TICK_INTERVAL_MS    = 30_000;
const WINDOW_SECONDS      = 300;
const MAX_DEMAND_QTY      = 10;
const MAX_DECAY_QTY       = 10;
const PRICE_STEP_DOWN     = 0.04;
const HISTORY_KEEP        = 60;
const PRUNE_EVENTS_SECONDS = 600;

function roundToNearest(value, step) {
  return Math.round(value / step) * step;
}

async function runTick() {
  // サブカテゴリ別アクティブドリンク数を取得
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
      min_price::float, max_price::float
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
        // ──── 1商品サブカテゴリ: 価格変動なし (base_priceへ緩やかに戻す) ────
        targetPrice = item.base_price;
      } else {
        // ──── 通常競合ロジック ────
        const competitorQty = (subcatDemandMap[item.subcategory_id] ?? 0) - itemQty;
        const surgeRatio    = Math.min(itemQty      / MAX_DEMAND_QTY, 1.0);
        const decayRatio    = Math.min(competitorQty / MAX_DECAY_QTY,  1.0);

        targetPrice = item.base_price
          + (item.max_price  - item.base_price) * surgeRatio
          - (item.base_price - item.min_price)  * decayRatio;
        targetPrice = Math.max(item.min_price, Math.min(item.max_price, targetPrice));
      }
    } else {
      // サブカテゴリなし: 標準サージのみ
      const surgeRatio = Math.min(itemQty / MAX_DEMAND_QTY, 1.0);
      targetPrice = item.base_price + (item.max_price - item.base_price) * surgeRatio;
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
             SELECT id FROM price_history
             WHERE menu_item_id = $1
             ORDER BY recorded_at DESC
             LIMIT $2
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

  // 全アイテムの最新価格を常にブロードキャスト (フロントエンドの同期用)
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

// ── 注文時の即時トリガー ──────────────────────────────
let running     = false;
let pendingTick = false; // 実行中にリクエストが来た場合、完了後に再実行

async function triggerTick() {
  if (running) {
    pendingTick = true; // キューに積む
    return;
  }
  running = true;
  try {
    await runTick();
    // 待機中のトリガーがあれば続けて処理
    if (pendingTick) {
      pendingTick = false;
      await runTick();
    }
  } catch (e) {
    console.error('[PricingEngine] triggered tick error:', e);
  } finally {
    running     = false;
    pendingTick = false;
  }
}

function startPricingEngine() {
  console.log('[PricingEngine] Starting...');
  runTick().catch((e) => console.error('[PricingEngine] initial tick error:', e));
  setInterval(() => {
    runTick().catch((e) => console.error('[PricingEngine] tick error:', e));
  }, TICK_INTERVAL_MS);
}

module.exports = { startPricingEngine, triggerTick };
