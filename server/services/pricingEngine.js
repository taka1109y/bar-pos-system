const { query } = require('../db/database');
const { broadcast } = require('./socketService');
const pricingSettings = require('./pricingSettings');
const pm = require('./pricingModel');
const { makeRng } = require('./rng');
const logger = require('../utils/logger');

const TZ = process.env.TZ_REPORT || 'Asia/Tokyo';

// ── 価格モデル(Phase7): pricing_base 中心 21点格子 ＋ カテゴリ内ゼロサム・シーソー ────────
// ・注文が入るとその銘柄=勝者が +k段(抽選)上昇し、同カテゴリの他銘柄へ上昇分を -1段ずつ配分(ゼロサム)。
//   → runSeesaw(orders.js から呼ぶ)。旧「注文で+1段(stepUpOnOrder)」と「期末減衰(runPeriodDecay)」を置換。
// ・時間減衰は廃止。価格は注文イベントのみで動く。市場オープンで全 engine_on 変動ドリンクを n=0(pricing_base)へ。
// ・暴落(hard_floor=実効floorへの即時遷移・復帰)は menu.js が担当。
// ・engine_off/固定/時価は markup 非適用＝常に定価(base)。
// ※旧 Phase4/Phase6版(stepUpOnOrder/減衰ロジック)は下部に DEPRECATED 残置(rollback用)。

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

// ★DEPRECATED(Phase7 runSeesaw で置換)★ 旧: 注文時に engine_enabled のドリンクを即時1段上昇。
// orders.js は runSeesaw を呼ぶよう変更済み。本関数は rollback 用に残置(参照しないこと)。
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

// Phase7 注文時: カテゴリ内ゼロサム・シーソー。
// 注文された銘柄=勝者が +k段(抽選 k∈{1,2,3}=0.6/0.3/0.1)上昇し、その上昇分を同カテゴリの
// 他 engine_on 変動ドリンクへ -1段ずつ抽選配分する(カテゴリ総量保存＝平均 pricing_base 維持)。
// 勝者は ceiling(n=+10)、犠牲は各自の実効floor(stored min_price)で頭打ち。厳密ゼロサム:
// 配分できた実数 r だけ勝者を上げる(勝者/犠牲の余地が尽きたら r に縮小)。時間減衰は無い。
// シード: テストは env SEESAW_SEED 固定で再現、本番は register_opened_at＋連番＋現在時刻で日々変わる。
let seesawSeq = 0; // 起動内の連番(シード変動用)
async function runSeesaw(menuItemId) {
  try {
    const { rows: wr } = await query(
      `SELECT id, name, category_id, base_price::float AS base_price, current_price::float AS cp,
         is_crashed, is_active, is_drink, engine_enabled, price_editable
       FROM menu_items WHERE id = $1`, [menuItemId]
    );
    const w = wr[0];
    // 勝者が engine_on の変動ドリンクでなければ変動なし(engine_off/時価/非ドリンク/暴落中)
    if (!w || !w.is_active || !w.is_drink || !w.engine_enabled || w.is_crashed || w.price_editable) return;

    // シード生成(テスト再現用)。本番は register_opened_at・連番・現在時刻で日々異なる列。
    const { rows: sr } = await query(`SELECT value FROM system_settings WHERE key = 'register_opened_at'`);
    const seq = ++seesawSeq;
    const seed = process.env.SEESAW_SEED
      ? `${process.env.SEESAW_SEED}:${seq}`
      : `${sr[0] && sr[0].value ? sr[0].value : 'x'}:${seq}:${Date.now()}`;
    const rng = makeRng(seed);
    const k = pm.drawSeesawSteps(rng);

    // 勝者の上げ余地(ceiling=n+10まで)
    const nW = pm.nForPrice(w.base_price, w.cp);
    const up0 = Math.min(k, pm.GRID_HALF_SPAN - nW);

    // 犠牲候補: 同カテゴリの engine_on 変動ドリンク(勝者除く)。stored min_price=実効floor を下限に使う。
    const { rows: cand } = await query(
      `SELECT id, name, base_price::float AS base_price, current_price::float AS cp, min_price::float AS minp
       FROM menu_items
       WHERE category_id = $1 AND id <> $2 AND is_drink = TRUE AND is_active = TRUE
         AND engine_enabled = TRUE AND is_crashed = FALSE AND price_editable = FALSE`,
      [w.category_id, w.id]
    );
    const victims = cand.map((c) => {
      const cN = pm.nForPrice(c.base_price, c.cp);
      const fN = pm.nForPrice(c.base_price, c.minp); // 実効floor の n
      return { id: c.id, name: c.name, base_price: c.base_price, cp: c.cp, n: cN, room: cN - fN };
    }).filter((v) => v.room > 0);

    // 犠牲を抽選順にシャッフルし、distinct 優先で -1 を配分(足りなければ floor まで重複)
    for (let i = victims.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [victims[i], victims[j]] = [victims[j], victims[i]];
    }
    const drops = new Map();
    let r = 0;
    while (r < up0) {
      let progressed = false;
      for (const v of victims) {
        if (r >= up0) break;
        if ((drops.get(v.id) || 0) < v.room) { drops.set(v.id, (drops.get(v.id) || 0) + 1); r++; progressed = true; }
      }
      if (!progressed) break; // 犠牲容量が尽きた
    }
    const up = r; // 厳密ゼロサム: 勝者上昇 = 犠牲合計下降
    if (up <= 0) return; // 上げ余地無し or 犠牲容量無し → 変動なし

    const bcast = (it, price, dir) => ({
      id: it.id, name: it.name, base_price: it.base_price, current_price: price,
      pct_change: it.base_price > 0 ? Math.round((price - it.base_price) / it.base_price * 1000) / 10 : 0,
      direction: dir,
    });
    const items = [];
    const wNew = pm.priceAtN(w.base_price, nW + up);
    if (wNew !== w.cp) { await applyPriceChange(w, w.cp, wNew, 'order', 'seesaw_win'); items.push(bcast(w, wNew, 'up')); }
    for (const v of victims) {
      const d = drops.get(v.id) || 0;
      if (d > 0) {
        const vNew = pm.priceAtN(v.base_price, v.n - d);
        if (vNew !== v.cp) { await applyPriceChange(v, v.cp, vNew, 'order', 'seesaw_lose'); items.push(bcast(v, vNew, 'down')); }
      }
    }
    if (items.length) broadcast('prices:updated', { items, timestamp: Date.now() });
  } catch (e) {
    logger.error({ err: e }, 'runSeesaw failed');
  }
}

// Phase7: 期タイマー(15分)。時間減衰は廃止したため価格は動かさず、盤面カウントダウン
// (period_ends_at / period:tick)と価格同期のみ更新する。関数名は互換のため据え置き(rollback容易化)。
async function runPeriodDecay() {
  try {
    const now = Date.now();
    // Phase7: 時間減衰は廃止(価格はシーソー=注文イベントでのみ動く)。期タイマーは盤面カウントダウン
    // (period_ends_at / period:tick)と価格同期を維持するため、期の更新とブロードキャストのみ行う。
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

// Phase7: 時間減衰・期タイマーは廃止。価格は注文シーソー(runSeesaw)と市場オープンでのみ動く。
function startPricingEngine() {
  logger.info('PricingEngine(Phase7 pricing_base grid + seesaw) starting');
}

// 互換: 期タイマー廃止に伴い no-op(settings.js の PATCH から呼ばれても無害)。
function restartInterval() { /* Phase7: 期タイマー廃止。何もしない */ }
// runPeriodDecay は Phase7 で未使用(期タイマー廃止)。export 互換のため残置。

// 互換: 旧 triggerTick は未使用(全体tickは廃止)。呼ばれても無害。
function triggerTick() { /* deprecated; 価格は runSeesaw で動く */ }

// Phase7 寄り付き(market open):
// ・engine_enabled=TRUE の非crashedドリンクを pricing_base(n=0) にリセット。
//   off品(ボトル/高額グラス/ノンアル/フード/裏/時価/薄利=定価固定)は据置。
// ・期起点 period_started_at を寄り付き時刻に合わせる(カウントダウン表示用)。
// ・price_events に event_type='market_open' を記録。prices:sync と market:open を通知。
// trigger: 手動リセット='manual'。※Phase7でレジオープンの自動発火は撤去(価格は持ち越し)。'auto'は現状未使用。
async function doMarketOpen(trigger = 'auto') {
  const { rows: items } = await query(`
    SELECT id, name, base_price::float AS base_price, current_price::float AS cp
    FROM menu_items
    WHERE is_drink = TRUE AND is_active = TRUE AND engine_enabled = TRUE AND is_crashed = FALSE
  `);
  let changed = 0;
  for (const it of items) {
    // F9: 1銘柄の失敗が寄り付き全体を中断しないよう個別に握る(期の起点設定・同期は必ず完遂させる)。
    try {
      const target = pm.pricingBase(it.base_price); // Phase7: 寄り付き=pricing_base(n=0)
      if (target !== it.cp) {
        await applyPriceChange(it, it.cp, target, trigger, 'market_open');
        changed++;
      }
    } catch (e) {
      logger.error({ err: e, id: it.id }, 'doMarketOpen: 銘柄の寄り付き適用に失敗(スキップ)');
    }
  }
  // Phase7: 期タイマー/カウントダウン廃止のため period_started_at/ends_at・period:tick は不要。
  await broadcastPricesSync();
  broadcast('market:open', { timestamp: Date.now() });
  logger.info({ changed, total: items.length, trigger }, 'PricingEngine market open (寄り付き)');
  return { changed, total: items.length };
}

module.exports = {
  startPricingEngine, restartInterval, triggerTick,
  stepUpOnOrder, runSeesaw, runPeriodDecay, broadcastPricesSync, doMarketOpen,
};
