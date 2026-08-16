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
// eventType は price_events.event_type（既定 'tick'。Phase6-3 の寄り付きは 'market_open' を渡す）
async function applyPriceChange(item, before, after, trigger, eventType = 'tick') {
  await query('UPDATE menu_items SET current_price = $1 WHERE id = $2', [after, item.id]);
  await query('INSERT INTO price_history (menu_item_id, price) VALUES ($1, $2)', [item.id, after]);
  await query(
    `INSERT INTO price_events (menu_item_id, price_before, price_after, event_type, trigger)
     VALUES ($1, $2, $3, $5, $4)`,
    [item.id, before, after, trigger, eventType]
  );
  // price_history を商品ごと HISTORY_KEEP 件に剪定（従来踏襲）
  const { HISTORY_KEEP } = pricingSettings.getSettings();
  await query(
    `DELETE FROM price_history WHERE menu_item_id = $1
       AND id NOT IN (SELECT id FROM price_history WHERE menu_item_id = $1 ORDER BY recorded_at DESC LIMIT $2)`,
    [item.id, HISTORY_KEEP]
  );
}

// Phase6(6-2) 注文時: engine_enabled のドリンクを即時1段上昇(格子・maxで頭打ち)。
// ・暴落中(is_crashed)は約定は hard_floor 価格で通すが、段index+1 は適用しない
//   (暴落終了時は「暴落前の段」へ復帰。暴落中の注文数で復帰位置が変わらないようにする)。
// ・idle_periods のリセットは runPeriodDecay 側で「当期に注文があった銘柄」を
//   order_items.created_at 基準で判定して行う(会計時刻ではなく注文時刻基準)。
async function stepUpOnOrder(menuItemId) {
  try {
    const { rows } = await query(
      `SELECT id, name, base_price::float AS base_price, current_price::float AS cp,
         is_crashed, is_active, is_drink, engine_enabled
       FROM menu_items WHERE id = $1`, [menuItemId]
    );
    const it = rows[0];
    // engine_enabled=false(ボトル/高額グラス/ノンアル/フード/裏/時価/薄利) と暴落中は段上昇の対象外
    if (!it || !it.is_active || !it.is_drink || !it.engine_enabled || it.is_crashed) return;
    const next = pm.gridStepUp(it.base_price, it.cp);
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
/* 旧Phase4版(参考・残置):
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
    if (next === it.cp) return;
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
*/

// Phase6(6-2) 期(既定15分)の減衰。減衰カウンタ idle_periods の意味論:
//   「在店期ベースで累積2無注文期で −1段、注文で0リセット、無人期はカウンタ・価格とも凍結」。
// ・在店判定: 期末時点で status='open' の未会計オーダーが1件以上あるか(スナップショット)。
// ・銘柄別の注文有無: 当期窓 [period_started_at, now] に order_items.created_at がある銘柄
//   (会計時刻ではなく注文明細の作成時刻基準。伝票が翌期に会計されても注文期に計上)。
// ・対象: engine_enabled=TRUE の非crashedドリンク。暴落中は idle_periods 凍結(WHERE で除外)。
// ・期の起点は状態(period_started_at → register_opened_at → now-PERIOD_MS)から読む
//   (壁時計の00/15/30/45分固定ではない。market_open 起点への整合は6-3で行う前提の構造)。
async function runPeriodDecay() {
  try {
    const now = Date.now();
    // 期の起点を状態から読む(6-3で market_open に整合させる)
    const { rows: st } = await query(
      `SELECT key, value FROM system_settings WHERE key IN ('period_started_at', 'register_opened_at')`
    );
    const smap = Object.fromEntries(st.map((r) => [r.key, r.value]));
    const startIso = smap.period_started_at || smap.register_opened_at || new Date(now - pm.PERIOD_MS).toISOString();

    // 在店(期末に未会計あり)判定
    const { rows: openRows } = await query(`SELECT COUNT(*)::int AS n FROM orders WHERE status = 'open'`);
    const occupied = openRows[0].n > 0;

    let changed = 0;
    if (occupied) {
      // 当期に注文があった銘柄(order_items.created_at 基準)
      const { rows: od } = await query(
        `SELECT DISTINCT menu_item_id FROM order_items WHERE created_at >= $1`, [startIso]
      );
      const ordered = new Set(od.map((r) => r.menu_item_id));
      const { rows: items } = await query(`
        SELECT id, name, base_price::float AS base_price, current_price::float AS cp, idle_periods
        FROM menu_items
        WHERE is_drink = TRUE AND is_active = TRUE AND is_crashed = FALSE AND engine_enabled = TRUE
      `);
      for (const it of items) {
        if (ordered.has(it.id)) {
          // 注文あり: カウンタ0リセット(価格は据え置き)
          if (it.idle_periods !== 0) await query('UPDATE menu_items SET idle_periods = 0 WHERE id = $1', [it.id]);
          continue;
        }
        // 在店・無注文: 累積+1。DECAY_IDLE_PERIODS に達したら −1段してカウンタ0へ
        const nextCount = it.idle_periods + 1;
        if (nextCount >= pm.DECAY_IDLE_PERIODS) {
          const next = pm.gridStepDown(it.base_price, it.cp);
          await query('UPDATE menu_items SET idle_periods = 0 WHERE id = $1', [it.id]);
          if (next !== it.cp) { await applyPriceChange(it, it.cp, next, 'decay'); changed++; }
        } else {
          await query('UPDATE menu_items SET idle_periods = $2 WHERE id = $1', [it.id, nextCount]);
        }
      }
    }
    // 無人期(!occupied)は何もしない: idle_periods・価格とも凍結

    // 次期の起点/終了を保存し、カウントダウン用に通知
    const endsAt = new Date(now + pm.PERIOD_MS).toISOString();
    const startNext = new Date(now).toISOString();
    await query(
      `INSERT INTO system_settings (key, value) VALUES ('period_started_at', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [startNext]
    );
    await query(
      `INSERT INTO system_settings (key, value) VALUES ('period_ends_at', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [endsAt]
    );
    await broadcastPricesSync();
    broadcast('period:tick', { endsAt, timestamp: now });
    if (changed > 0) logger.info({ count: changed, occupied }, 'PricingEngine period decay(Phase6)');
  } catch (e) {
    logger.error({ err: e }, 'runPeriodDecay failed');
  }
}
/* 旧Phase4版(参考・残置):
async function runPeriodDecay() {
  try {
    const { rows: items } = await query(`
      SELECT id, name, base_price::float AS base_price, current_price::float AS cp,
        min_price::float AS minp, max_price::float AS maxp, price_step_down::float AS step
      FROM menu_items
      WHERE is_drink = TRUE AND is_active = TRUE AND is_crashed = FALSE AND min_price <> max_price
    `);
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
*/

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

// Phase6(6-3) 寄り付き(market open):
// ・engine_enabled=TRUE の非crashedドリンクを anchor(base×1.1) にリセット・idle_periods=0。
//   off品(ボトル/高額グラス/ノンアル/フード/裏/時価/薄利=定価固定)は据置。
// ・期起点 period_started_at を寄り付き時刻に合わせる(6-2の減衰期をオープン起点で刻む)。
// ・price_events に event_type='market_open' を記録。prices:sync と market:open を通知。
// trigger: レジオープン='auto' / 手動リセット='manual'。
async function doMarketOpen(trigger = 'auto') {
  const startedAt = new Date().toISOString();
  const { rows: items } = await query(`
    SELECT id, name, base_price::float AS base_price, current_price::float AS cp
    FROM menu_items
    WHERE is_drink = TRUE AND is_active = TRUE AND engine_enabled = TRUE AND is_crashed = FALSE
  `);
  let changed = 0;
  for (const it of items) {
    const anchor = pm.anchorP6(it.base_price);
    await query('UPDATE menu_items SET idle_periods = 0 WHERE id = $1', [it.id]);
    if (anchor !== it.cp) {
      await applyPriceChange(it, it.cp, anchor, trigger, 'market_open');
      changed++;
    }
  }
  const endsAt = new Date(Date.now() + pm.PERIOD_MS).toISOString();
  await query(`INSERT INTO system_settings (key, value) VALUES ('period_started_at', $1)
               ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [startedAt]);
  await query(`INSERT INTO system_settings (key, value) VALUES ('period_ends_at', $1)
               ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [endsAt]);
  await broadcastPricesSync();
  broadcast('market:open', { timestamp: Date.now(), endsAt });
  broadcast('period:tick', { endsAt, timestamp: Date.now() });
  logger.info({ changed, total: items.length, trigger }, 'PricingEngine market open (寄り付き)');
  return { changed, total: items.length };
}

module.exports = {
  startPricingEngine, restartInterval, triggerTick,
  stepUpOnOrder, runPeriodDecay, broadcastPricesSync, doMarketOpen,
};
