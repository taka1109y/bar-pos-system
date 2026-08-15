const { query } = require('../db/database');
const { broadcast } = require('./socketService');
const pricingSettings = require('./pricingSettings');
const pm = require('./pricingModel');
const logger = require('../utils/logger');

const TZ = process.env.TZ_REPORT || 'Asia/Tokyo';

// ── 価格モデル(Phase4): 呼値ラダー × 15分期 ─────────────────────────────
// ・注文が入った瞬間に、その銘柄を即時1段上昇（stepUpOnOrder, orders.js から呼ぶ）
// ・15分「期」の区切りで、その期に注文が無かった銘柄を1段減衰（runPeriodDecay, 定期実行）
// ・影響は個別銘柄のみ（カテゴリ/サブカテゴリ競合は使わない）。乱数なし。整数(25円)演算。
// ・暴落(最下段への即時遷移・復帰)は menu.js が担当。
//   従来の需要競合ロジック(groupKey)は Phase4 で本モデルに置換した(承認済み)。

// 全ドリンクの最新価格をボードへ同期（暴落中も現在価格のまま含める）
async function broadcastPricesSync() {
  const { rows } = await query(`
    SELECT m.id, m.name,
      m.base_price::float, m.current_price::float,
      COALESCE(ROUND((m.current_price - m.base_price) * 100.0 / NULLIF(m.base_price, 0), 1), 0)::float AS pct_change,
      c.id AS category_id, c.name AS category_name
    FROM menu_items m
    JOIN categories c ON m.category_id = c.id
    LEFT JOIN subcategories sc ON m.subcategory_id = sc.id
    WHERE m.is_drink = TRUE AND m.is_active = TRUE AND m.is_staff_only = FALSE
    ORDER BY c.sort_order, sc.sort_order NULLS LAST, m.sort_order, m.name
  `);
  const items = rows.map((r) => ({
    ...r,
    direction: r.pct_change > 0 ? 'up' : r.pct_change < 0 ? 'down' : 'flat',
  }));
  broadcast('prices:sync', { items, timestamp: Date.now() });
}

// 価格変更を記録し、price_events / price_history に残す共通処理（整数前提）
async function applyPriceChange(item, before, after, trigger) {
  await query('UPDATE menu_items SET current_price = $1 WHERE id = $2', [after, item.id]);
  await query('INSERT INTO price_history (menu_item_id, price) VALUES ($1, $2)', [item.id, after]);
  await query(
    `INSERT INTO price_events (menu_item_id, price_before, price_after, event_type, trigger)
     VALUES ($1, $2, $3, 'tick', $4)`,
    [item.id, before, after, trigger]
  );
  // price_history を商品ごと HISTORY_KEEP 件に剪定（従来踏襲）
  const { HISTORY_KEEP } = pricingSettings.getSettings();
  await query(
    `DELETE FROM price_history WHERE menu_item_id = $1
       AND id NOT IN (SELECT id FROM price_history WHERE menu_item_id = $1 ORDER BY recorded_at DESC LIMIT $2)`,
    [item.id, HISTORY_KEEP]
  );
}

// 注文時: その銘柄を即時1段上昇（≤max）。crashed/ロック(min=max)/非ドリンクは対象外。
async function stepUpOnOrder(menuItemId) {
  try {
    const { rows } = await query(
      `SELECT id, name, base_price::float AS base_price, current_price::float AS cp,
         min_price::float AS minp, max_price::float AS maxp, price_step_up::float AS step,
         is_crashed, is_active, is_drink
       FROM menu_items WHERE id = $1`, [menuItemId]
    );
    const it = rows[0];
    if (!it || !it.is_active || !it.is_drink || it.is_crashed || it.minp === it.maxp) return;
    const step = it.step && it.step > 0 ? it.step : pm.ladderStep(it.minp, it.maxp);
    const next = pm.stepUp(it.cp, it.minp, it.maxp, step);
    if (next === it.cp) return; // 既に最上段
    await applyPriceChange(it, it.cp, next, 'order');
    const pct = it.base_price > 0 ? Math.round((next - it.base_price) / it.base_price * 1000) / 10 : 0;
    broadcast('prices:updated', {
      items: [{ id: it.id, name: it.name, base_price: it.base_price, current_price: next, pct_change: pct, direction: 'up' }],
      timestamp: Date.now(),
    });
  } catch (e) {
    logger.error({ err: e }, 'stepUpOnOrder failed');
  }
}

// 15分期の減衰: 当期に注文が無かった非ロック・非crashedを1段減衰（≥min）。
async function runPeriodDecay() {
  try {
    const { rows: items } = await query(`
      SELECT id, name, base_price::float AS base_price, current_price::float AS cp,
        min_price::float AS minp, max_price::float AS maxp, price_step_down::float AS step
      FROM menu_items
      WHERE is_drink = TRUE AND is_active = TRUE AND is_crashed = FALSE AND min_price <> max_price
    `);
    // 当期(直近 PERIOD_MS)に注文があった銘柄は据え置き
    const { rows: demand } = await query(
      `SELECT DISTINCT menu_item_id FROM pricing_events WHERE event_time > NOW() - ($1::bigint * INTERVAL '1 millisecond')`,
      [pm.PERIOD_MS]
    );
    const ordered = new Set(demand.map((d) => d.menu_item_id));
    let changed = 0;
    for (const it of items) {
      if (ordered.has(it.id)) continue;
      const step = it.step && it.step > 0 ? it.step : pm.ladderStep(it.minp, it.maxp);
      const next = pm.stepDown(it.cp, it.minp, it.maxp, step);
      if (next !== it.cp) { await applyPriceChange(it, it.cp, next, 'decay'); changed++; }
    }
    // 次の期の終了時刻を保存し、カウントダウン用に通知
    const endsAt = new Date(Date.now() + pm.PERIOD_MS).toISOString();
    await query(
      `INSERT INTO system_settings (key, value) VALUES ('period_ends_at', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [endsAt]
    );
    await broadcastPricesSync();
    broadcast('period:tick', { endsAt, timestamp: Date.now() });
    if (changed > 0) logger.info({ count: changed }, 'PricingEngine period decay');
  } catch (e) {
    logger.error({ err: e }, 'runPeriodDecay failed');
  }
}

let periodTimer = null;

function startPricingEngine() {
  logger.info('PricingEngine(Phase4 ladder) starting');
  // 起動時に period_ends_at を必ずセットしてから定期減衰を開始
  runPeriodDecay().catch((e) => logger.error({ err: e }, 'PricingEngine initial period error'));
  periodTimer = setInterval(() => {
    runPeriodDecay().catch((e) => logger.error({ err: e }, 'PricingEngine period error'));
  }, pm.PERIOD_MS);
}

function restartInterval() {
  if (periodTimer) clearInterval(periodTimer);
  periodTimer = setInterval(() => {
    runPeriodDecay().catch((e) => logger.error({ err: e }, 'PricingEngine period error'));
  }, pm.PERIOD_MS);
  logger.info({ periodMs: pm.PERIOD_MS }, 'PricingEngine period interval restarted');
}

// 互換: 旧 triggerTick は Phase4 では未使用(全体tickは廃止)。呼ばれても無害。
function triggerTick() { /* deprecated in Phase4; per-item step-up is via stepUpOnOrder */ }

module.exports = {
  startPricingEngine, restartInterval, triggerTick,
  stepUpOnOrder, runPeriodDecay, broadcastPricesSync,
};
