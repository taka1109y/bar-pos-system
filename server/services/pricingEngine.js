const { query } = require('../db/database');
const { broadcast } = require('./socketService');
const pricingSettings = require('./pricingSettings');
const logger = require('../utils/logger');

const TZ = process.env.TZ_REPORT || 'Asia/Tokyo';

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

  // 競合スコープ: カテゴリ全体ON のカテゴリは配下の全ドリンクを1グループにする（サブカテゴリ跨ぎ）。
  // それ以外はサブカテゴリ単位（従来）。グループキーで需要・商品数を集計する。
  const { rows: catRows } = await query(`SELECT id, competition_category_wide FROM categories`);
  const catWide = Object.fromEntries(catRows.map((r) => [r.id, r.competition_category_wide]));
  const groupKey = (categoryId, subcategoryId) => {
    if (catWide[categoryId]) return `c${categoryId}`;
    if (subcategoryId != null) return `s${subcategoryId}`;
    return null;
  };

  // グループ別アクティブドリンク数
  const { rows: countRows } = await query(`
    SELECT category_id, subcategory_id
    FROM menu_items
    WHERE is_drink = TRUE AND is_active = TRUE
  `);
  const groupCountMap = {};
  for (const r of countRows) {
    const k = groupKey(r.category_id, r.subcategory_id);
    if (k) groupCountMap[k] = (groupCountMap[k] ?? 0) + 1;
  }

  const { rows: items } = await query(`
    SELECT id, name, category_id, subcategory_id,
      base_price::float, current_price::float,
      min_price::float, max_price::float,
      price_step_up::float, price_step_down::float
    FROM menu_items
    WHERE is_drink = TRUE AND is_active = TRUE AND is_crashed = FALSE
  `);

  const { rows: demandRows } = await query(
    `SELECT menu_item_id, COALESCE(SUM(quantity), 0)::int AS total_qty
     FROM pricing_events
     WHERE event_time > NOW() - $1 * INTERVAL '1 second'
     GROUP BY menu_item_id`,
    [WINDOW_SECONDS]
  );
  const demandMap = Object.fromEntries(demandRows.map((r) => [r.menu_item_id, r.total_qty]));

  // グループ別の合計需要
  const groupDemandMap = {};
  for (const item of items) {
    const k = groupKey(item.category_id, item.subcategory_id);
    if (k) {
      const qty = demandMap[item.id] ?? 0;
      groupDemandMap[k] = (groupDemandMap[k] ?? 0) + qty;
    }
  }

  const updates = [];

  for (const item of items) {
    const itemQty = demandMap[item.id] ?? 0;

    let targetPrice;

    const gKey = groupKey(item.category_id, item.subcategory_id);
    if (gKey != null) {
      const groupItemCount = groupCountMap[gKey] ?? 0;

      if (groupItemCount <= 1) {
        // グループに1商品のみ: base_price へ緩やかに戻す
        targetPrice = item.base_price;
      } else {
        // 競合ロジック: 自分の注文数 × step_up、競合注文数 × step_down
        const competitorQty = (groupDemandMap[gKey] ?? 0) - itemQty;
        targetPrice = item.base_price
          + itemQty       * item.price_step_up
          - competitorQty * item.price_step_down;
        targetPrice = Math.max(item.min_price, Math.min(item.max_price, targetPrice));
      }
    } else {
      // グループなし（サブカテゴリなし・カテゴリ全体OFF）: 自分の注文数 × step_up のみ
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
    newPrice = Math.max(item.min_price, Math.min(item.max_price, newPrice));

    if (newPrice !== item.current_price) {
      await query('UPDATE menu_items SET current_price = $1 WHERE id = $2', [newPrice, item.id]);
      await query('INSERT INTO price_history (menu_item_id, price) VALUES ($1, $2)', [item.id, newPrice]);
      // 計装(1-1): 価格変動イベントを永続記録（tick）。変動前=旧current, 変動後=newPrice。
      await query(
        `INSERT INTO price_events (menu_item_id, price_before, price_after, event_type, trigger)
         VALUES ($1, $2, $3, 'tick', 'engine')`,
        [item.id, item.current_price, newPrice]
      );

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

  // 計装(1-1): 需要ログ(pricing_events)は分析(A2:暴落後15分抽出)のため永続化する。
  // 剪定は PRUNE_EVENTS_SECONDS > 0 のときのみ実行（既定0=剪定なし）。増大時は削除でなくアーカイブで対応。
  if (PRUNE_EVENTS_SECONDS > 0) {
    await query(
      `DELETE FROM pricing_events WHERE event_time < NOW() - $1 * INTERVAL '1 second'`,
      [PRUNE_EVENTS_SECONDS]
    );
  }

  if (updates.length > 0) {
    const updatedIds = updates.map((u) => u.id);
    const { rows: dayStats } = await query(
      `SELECT menu_item_id,
         MAX(price)::float AS day_high,
         MIN(price)::float AS day_low
       FROM price_history
       WHERE menu_item_id = ANY($1)
         AND (recorded_at AT TIME ZONE $2)::date = (NOW() AT TIME ZONE $2)::date
       GROUP BY menu_item_id`,
      [updatedIds, TZ]
    );
    const dayStatsMap = Object.fromEntries(dayStats.map((r) => [r.menu_item_id, r]));

    const updatesWithStats = updates.map((u) => ({
      ...u,
      day_high: dayStatsMap[u.id]?.day_high ?? u.current_price,
      day_low:  dayStatsMap[u.id]?.day_low  ?? u.current_price,
    }));

    broadcast('prices:updated', { items: updatesWithStats, timestamp: Date.now() });
    logger.info({ count: updates.length }, 'PricingEngine price updated');
  }

  // 全アイテムの最新価格をブロードキャスト（暴落中アイテムも現在価格のまま含める。
  // 除外すると prices:sync を全置換で受け取るクライアントの価格リストから暴落中商品が消えてしまうため）
  const { rows: allPrices } = await query(`
    SELECT m.id, m.name,
      m.base_price::float, m.current_price::float,
      COALESCE(ROUND((m.current_price - m.base_price) * 100.0 / NULLIF(m.base_price, 0), 1), 0)::float AS pct_change,
      c.id AS category_id,
      c.name AS category_name
    FROM menu_items m
    JOIN categories c ON m.category_id = c.id
    LEFT JOIN subcategories sc ON m.subcategory_id = sc.id
    WHERE m.is_drink = TRUE AND m.is_active = TRUE AND m.is_staff_only = FALSE
    ORDER BY c.sort_order, sc.sort_order NULLS LAST, m.sort_order, m.name
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
    logger.error({ err: e }, 'PricingEngine triggered tick error');
  } finally {
    running = false; pendingTick = false;
  }
}

let tickTimer = null;

function startPricingEngine() {
  const { TICK_INTERVAL_MS } = pricingSettings.getSettings();
  logger.info('PricingEngine starting');
  runTick().catch((e) => logger.error({ err: e }, 'PricingEngine initial tick error'));
  tickTimer = setInterval(() => {
    runTick().catch((e) => logger.error({ err: e }, 'PricingEngine tick error'));
  }, TICK_INTERVAL_MS);
}

function restartInterval() {
  if (tickTimer) clearInterval(tickTimer);
  const { TICK_INTERVAL_MS } = pricingSettings.getSettings();
  tickTimer = setInterval(() => {
    runTick().catch((e) => logger.error({ err: e }, 'PricingEngine tick error'));
  }, TICK_INTERVAL_MS);
  logger.info({ intervalMs: TICK_INTERVAL_MS }, 'PricingEngine interval restarted');
}

module.exports = { startPricingEngine, triggerTick, restartInterval };
