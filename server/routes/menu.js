const express = require('express');
const router = express.Router();
const { pool, query } = require('../db/database');
const { broadcast } = require('../services/socketService');
const crashCfg = require('../services/crashSettings');
const pm = require('../services/pricingModel');

// 手動暴落(フェーズ3)用の丸めヘルパー
const _round25 = (v) => Math.round(v / crashCfg.PRICE_ROUND_UNIT) * crashCfg.PRICE_ROUND_UNIT;
const _ceil25  = (v) => Math.ceil(v / crashCfg.PRICE_ROUND_UNIT) * crashCfg.PRICE_ROUND_UNIT;
let _manualCrashTimer = null;

// Phase6(承認済 6-1): 価格格子モデル。基準価格から min/max/呼値/現在価格 を算出。
// 格子 = base + n×step。soft_floor=base(=min) / anchor=base×1.1(新規は寄り付き値で上場) / max=base×1.2。
// ロック/非ドリンク/時価(price_editable) は固定価格(min=max=current=base)。
// ※旧 Phase4版(computeMin/computeMax/ladderStep/snapToLadder)は pricingModel に残置(ロールバック用)。
// cost は Phase6 では未使用(暴落下限 hard_floor は暴落時に算出)。互換のため引数は残す。
function computeLadder(base, cost, { locked, isDrink, priceEditable }) {
  const variable = isDrink && !priceEditable && !locked;
  const step = pm.stepForBase(base);
  if (!variable) {
    const p = pm.softFloor(base); // = base(格子点)
    return { min: p, max: p, step, current: p };
  }
  const min = pm.softFloor(base);
  let max = pm.maxP6(base);
  if (max < min) max = min;
  return { min, max, step, current: pm.anchorP6(base) };
}

// 暴落中の全商品を「暴落前価格」に戻し、crash_reset を記録して解除を通知する（自動/手動解除で共用）。
// 復帰先=直近 crash_manual/crash の price_before（ラダーにスナップ）。取得できなければ base_price。
async function performManualCrashReset(triggerLabel) {
  const { rows: before } = await query(
    `SELECT id, current_price::float AS current_price, base_price::float AS base_price,
       min_price::float AS minp, max_price::float AS maxp, price_step_up::float AS step
     FROM menu_items WHERE is_crashed = TRUE AND is_active = TRUE`
  );
  if (before.length === 0) {
    await query(`DELETE FROM system_settings WHERE key IN ('crash_started_at','crash_ends_at')`);
    return { updated: 0 };
  }
  // 各商品の暴落直前価格（最新の crash 系イベントの price_before）
  const { rows: preRows } = await query(`
    SELECT DISTINCT ON (menu_item_id) menu_item_id, price_before::float AS price_before
    FROM price_events WHERE event_type IN ('crash_manual','crash')
    ORDER BY menu_item_id, id DESC
  `);
  const preMap = Object.fromEntries(preRows.map((r) => [r.menu_item_id, r.price_before]));
  for (const b of before) {
    const raw = preMap[b.id] != null ? preMap[b.id] : b.base_price;
    // ロック(min=max)は min に、可変はラダーにスナップして復帰
    const restore = b.minp === b.maxp
      ? b.base_price
      : pm.snapToLadder(raw, b.minp, b.maxp, (b.step && b.step > 0) ? b.step : pm.ladderStep(b.minp, b.maxp));
    await query('UPDATE menu_items SET current_price = $1, is_crashed = FALSE WHERE id = $2', [restore, b.id]);
    await query(
      `INSERT INTO price_events (menu_item_id, price_before, price_after, event_type, trigger)
       VALUES ($1, $2, $3, 'crash_reset', $4)`,
      [b.id, b.current_price, restore, triggerLabel]
    );
  }
  await query(`DELETE FROM system_settings WHERE key IN ('crash_started_at','crash_ends_at')`);
  const { rows: allPrices } = await query(`
    SELECT id, name, base_price::float, current_price::float,
      COALESCE(ROUND((current_price - base_price) * 100.0 / NULLIF(base_price, 0), 1), 0)::float AS pct_change
    FROM menu_items WHERE is_drink = TRUE AND is_active = TRUE
  `);
  const items = allPrices.map((r) => ({ ...r, direction: r.pct_change > 0 ? 'up' : r.pct_change < 0 ? 'down' : 'flat' }));
  broadcast('prices:updated', { items, timestamp: Date.now() });
  broadcast('crash:ended', { timestamp: Date.now() });
  return { updated: before.length };
}

// フェーズ3: 手動暴落の継続時間(crash_ends_at)経過を独立監視して自動解除する。
// 価格エンジンのtick間隔(本番は長時間)に依存しないよう、専用の軽量インターバルで20秒ごとに確認する。
// サーバ再起動時も起動直後に1回チェックするため、暴落中に再起動しても期限経過分は解除される。
let _crashWatcherStarted = false;
async function _checkCrashExpiry() {
  const { rows: ce } = await query(`SELECT value FROM system_settings WHERE key = 'crash_ends_at'`);
  if (ce[0] && new Date(ce[0].value).getTime() <= Date.now()) {
    await performManualCrashReset('auto');
  }
}
function startCrashWatcher() {
  if (_crashWatcherStarted) return;
  _crashWatcherStarted = true;
  _checkCrashExpiry().catch(() => {}); // 起動直後の再起動リカバリ
  setInterval(() => { _checkCrashExpiry().catch(() => {}); }, 20 * 1000);
}

const ITEM_SELECT = `
  SELECT m.id, m.category_id, m.subcategory_id, m.name,
    m.base_price::float, m.current_price::float,
    m.min_price::float, m.max_price::float,
    m.price_step_up::float, m.price_step_down::float,
    m.sort_order,
    COALESCE((
      SELECT SUM(r.usage_quantity * i.cost_per_purchase_unit / NULLIF(i.purchase_quantity, 0))
      FROM recipes r JOIN ingredients i ON r.ingredient_id = i.id
      WHERE r.menu_item_id = m.id
    ), 0)::float AS cost_price,
    m.recipe_notes,
    m.is_drink, m.is_active, m.crash_enabled, m.is_crashed,
    m.image_url, m.tax_category, m.is_staff_only, m.price_editable,
    m.question_text, m.question_choices, m.question_allow_multiple, m.question_allow_quantity,
    c.name  AS category_name,  c.sort_order AS category_sort_order,
    sc.name AS subcategory_name, sc.sort_order AS subcategory_sort_order
  FROM menu_items m
  JOIN categories c ON m.category_id = c.id
  LEFT JOIN subcategories sc ON m.subcategory_id = sc.id
`;

// 注文時の質問設定（question_text/question_choices）のバリデーション・正規化
// question_text が空なら質問なし（qText=null, qChoices=null）を返す
// question_choices の各要素は {label, priceDelta} オブジェクト、または後方互換のため文字列（priceDelta=0扱い）を受け付ける
// 戻り値: { qText, qChoices: [{label, priceDelta}] } または throw { status: 400, error: string }
function resolveQuestionConfig(question_text, question_choices) {
  const trimmedText = typeof question_text === 'string' ? question_text.trim() : '';
  if (!trimmedText) return { qText: null, qChoices: null };

  if (trimmedText.length > 200) {
    throw { status: 400, error: 'question_text must be 200 characters or fewer' };
  }
  if (!Array.isArray(question_choices)) {
    throw { status: 400, error: 'question_choices must be an array when question_text is set' };
  }

  const normalized = question_choices.map((c) => {
    if (typeof c === 'string') return { label: c.trim(), priceDelta: 0 };
    if (c && typeof c === 'object') {
      const label = String(c.label ?? '').trim();
      const priceDelta = Number(c.priceDelta);
      return { label, priceDelta: Number.isFinite(priceDelta) ? Math.round(priceDelta) : 0 };
    }
    return { label: '', priceDelta: 0 };
  }).filter((c) => c.label.length > 0);

  const seen = new Set();
  const cleaned = [];
  for (const c of normalized) {
    if (seen.has(c.label)) continue;
    seen.add(c.label);
    cleaned.push(c);
  }

  if (cleaned.length < 2) {
    throw { status: 400, error: 'question_choices must contain at least 2 unique non-empty options' };
  }
  if (cleaned.some((c) => c.label.length > 50)) {
    throw { status: 400, error: 'each choice must be 50 characters or fewer' };
  }
  return { qText: trimmedText, qChoices: cleaned };
}

// ─── カテゴリ ────────────────────────────────────────

// GET /api/menu/categories
router.get('/categories', async (req, res, next) => {
  try {
    const includeStaff = req.query.staff === 'true';
    const staffFilter  = includeStaff ? '' : 'WHERE is_staff_only = FALSE';
    const { rows } = await query(
      `SELECT id, name, sort_order, crash_pct::float, is_staff_only, competition_category_wide
       FROM categories ${staffFilter} ORDER BY sort_order`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// POST /api/menu/categories
router.post('/categories', async (req, res, next) => {
  try {
    const { name, sort_order = 0, is_staff_only = false, competition_category_wide = false } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const { rows } = await query(
      'INSERT INTO categories (name, sort_order, is_staff_only, competition_category_wide) VALUES ($1, $2, $3, $4) RETURNING id, name, sort_order, crash_pct::float, is_staff_only, competition_category_wide',
      [name, sort_order, Boolean(is_staff_only), Boolean(competition_category_wide)]
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// PATCH /api/menu/categories/:id
router.patch('/categories/:id', async (req, res, next) => {
  try {
    const { rows: existing } = await query('SELECT id FROM categories WHERE id = $1', [req.params.id]);
    if (!existing[0]) return res.status(404).json({ error: 'Category not found' });

    const { name, sort_order, crash_pct, is_staff_only, competition_category_wide } = req.body;
    const updates = [];
    const values = [];
    let idx = 1;
    if (name !== undefined)          { updates.push(`name = $${idx++}`);          values.push(name); }
    if (sort_order !== undefined)    { updates.push(`sort_order = $${idx++}`);    values.push(sort_order); }
    if (crash_pct !== undefined)     { updates.push(`crash_pct = $${idx++}`);     values.push(crash_pct); }
    if (is_staff_only !== undefined) { updates.push(`is_staff_only = $${idx++}`); values.push(Boolean(is_staff_only)); }
    if (competition_category_wide !== undefined) { updates.push(`competition_category_wide = $${idx++}`); values.push(Boolean(competition_category_wide)); }
    if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

    values.push(req.params.id);
    const { rows } = await query(
      `UPDATE categories SET ${updates.join(', ')} WHERE id = $${idx} RETURNING id, name, sort_order, crash_pct::float, is_staff_only, competition_category_wide`,
      values
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// DELETE /api/menu/categories/:id
router.delete('/categories/:id', async (req, res, next) => {
  try {
    const { rows: existing } = await query('SELECT id FROM categories WHERE id = $1', [req.params.id]);
    if (!existing[0]) return res.status(404).json({ error: 'Category not found' });

    const { rows: items } = await query(
      'SELECT COUNT(*) as c FROM menu_items WHERE category_id = $1', [req.params.id]
    );
    if (parseInt(items[0].c) > 0) {
      return res.status(409).json({ error: 'Cannot delete category with menu items' });
    }
    await query('DELETE FROM categories WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── サブカテゴリ ─────────────────────────────────────

// GET /api/menu/subcategories
router.get('/subcategories', async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT sc.id, sc.category_id, sc.name, sc.sort_order, sc.crash_pct::float,
        c.name AS category_name
      FROM subcategories sc
      JOIN categories c ON sc.category_id = c.id
      ORDER BY c.sort_order, sc.sort_order
    `);
    res.json(rows);
  } catch (err) { next(err); }
});

// POST /api/menu/subcategories
router.post('/subcategories', async (req, res, next) => {
  try {
    const { category_id, name, sort_order = 0 } = req.body;
    if (!category_id || !name) return res.status(400).json({ error: 'category_id and name are required' });

    const { rows: catCheck } = await query('SELECT id FROM categories WHERE id = $1', [category_id]);
    if (!catCheck[0]) return res.status(400).json({ error: 'category_id does not exist' });

    const { rows } = await query(
      'INSERT INTO subcategories (category_id, name, sort_order) VALUES ($1, $2, $3) RETURNING id, category_id, name, sort_order, crash_pct::float',
      [category_id, name, sort_order]
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// PATCH /api/menu/subcategories/:id
router.patch('/subcategories/:id', async (req, res, next) => {
  try {
    const { rows: existing } = await query('SELECT id FROM subcategories WHERE id = $1', [req.params.id]);
    if (!existing[0]) return res.status(404).json({ error: 'Subcategory not found' });

    const { name, sort_order, category_id, crash_pct } = req.body;
    const updates = [];
    const values = [];
    let idx = 1;
    if (name !== undefined)        { updates.push(`name = $${idx++}`);        values.push(name); }
    if (sort_order !== undefined)  { updates.push(`sort_order = $${idx++}`);  values.push(sort_order); }
    if (category_id !== undefined) { updates.push(`category_id = $${idx++}`); values.push(category_id); }
    if (crash_pct !== undefined)   { updates.push(`crash_pct = $${idx++}`);   values.push(crash_pct); }
    if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

    values.push(req.params.id);
    const { rows } = await query(
      `UPDATE subcategories SET ${updates.join(', ')} WHERE id = $${idx} RETURNING id, category_id, name, sort_order, crash_pct::float`,
      values
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// DELETE /api/menu/subcategories/:id
router.delete('/subcategories/:id', async (req, res, next) => {
  try {
    const { rows: existing } = await query('SELECT id FROM subcategories WHERE id = $1', [req.params.id]);
    if (!existing[0]) return res.status(404).json({ error: 'Subcategory not found' });

    // 商品のサブカテゴリはNULLに設定 (ON DELETE SET NULL)
    await query('DELETE FROM subcategories WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── メニューアイテム ─────────────────────────────────

// GET /api/menu (アクティブのみ。?staff=true で従業員専用商品も含む)
router.get('/', async (req, res, next) => {
  try {
    const includeStaff = req.query.staff === 'true';
    const staffFilter  = includeStaff ? '' : 'AND m.is_staff_only = FALSE';
    const { rows } = await query(
      `${ITEM_SELECT} WHERE m.is_active = TRUE ${staffFilter} ORDER BY c.sort_order, sc.sort_order NULLS LAST, m.sort_order, m.name`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /api/menu/all
router.get('/all', async (req, res, next) => {
  try {
    const { rows } = await query(
      `${ITEM_SELECT} ORDER BY c.sort_order, sc.sort_order NULLS LAST, m.sort_order, m.name`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// POST /api/menu
router.post('/', async (req, res, next) => {
  try {
    const { category_id, subcategory_id, name, base_price, min_price, max_price,
            price_step_up, price_step_down, is_drink = true, image_url = null,
            tax_category, is_staff_only = false, price_editable = false,
            question_text = null, question_choices = null, question_allow_multiple = false, question_allow_quantity = false } = req.body;
    if (!category_id || !name || base_price == null) {
      return res.status(400).json({ error: 'category_id, name, base_price are required' });
    }
    if (typeof name !== 'string' || name.trim().length === 0 || name.length > 100) {
      return res.status(400).json({ error: 'name must be 1-100 characters' });
    }
    if (isNaN(Number(base_price)) || Number(base_price) < 0) {
      return res.status(400).json({ error: 'base_price must be a non-negative number' });
    }
    // tax_category 未指定時は system_settings の default_tax_category を使用
    let effectiveTaxCategory = tax_category;
    if (!effectiveTaxCategory) {
      const { rows: s } = await query(
        "SELECT value FROM system_settings WHERE key = 'default_tax_category'"
      );
      effectiveTaxCategory = s[0]?.value ?? 'standard';
    }
    if (!['standard', 'reduced'].includes(effectiveTaxCategory)) {
      return res.status(400).json({ error: 'tax_category must be standard or reduced' });
    }
    let qText, qChoices;
    try {
      ({ qText, qChoices } = resolveQuestionConfig(question_text, question_choices));
    } catch (e) {
      if (e.status) return res.status(e.status).json({ error: e.error });
      throw e;
    }
    // Phase4/5: min/max/段(呼値)は基準価格から自動計算（手動入力は無視）。
    // ロック(price_locked)/非ドリンク/時価は固定価格(min=max)。原価は作成時0（レシピは後付け）。
    const ladder = computeLadder(Number(base_price), 0, {
      locked: Boolean(req.body.price_locked), isDrink: is_drink, priceEditable: price_editable,
    });
    const minP = ladder.min, maxP = ladder.max, stepUp = ladder.step, stepDn = ladder.step, curP = ladder.current;
    // 質問が無い商品は複数選択/数量指定フラグを強制的に false にする
    const allowMultiple = qText ? Boolean(question_allow_multiple) : false;
    const allowQuantity = qText ? Boolean(question_allow_quantity) : false;
    const { rows } = await query(
      `INSERT INTO menu_items
         (category_id, subcategory_id, name, base_price, current_price, min_price, max_price, price_step_up, price_step_down, is_drink, image_url, tax_category, is_staff_only, price_editable, question_text, question_choices, question_allow_multiple, question_allow_quantity, sort_order)
       VALUES ($1, $2, $3, $4, $18, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
         COALESCE((SELECT MAX(sort_order) FROM menu_items WHERE category_id = $1 AND subcategory_id IS NOT DISTINCT FROM $2), -1) + 1)
       RETURNING id`,
      [category_id, subcategory_id || null, name.trim(), base_price, minP, maxP, stepUp, stepDn, is_drink, image_url || null, effectiveTaxCategory, Boolean(is_staff_only), Boolean(price_editable), qText, qChoices ? JSON.stringify(qChoices) : null, allowMultiple, allowQuantity, curP]
    );
    // 計装(1-2): 商品作成時の初期 base_price を履歴に記録（before=NULL）
    await query(
      `INSERT INTO base_price_history (menu_item_id, price_before, price_after, operator)
       VALUES ($1, NULL, $2, NULL)`,
      [rows[0].id, base_price]
    );
    const { rows: result } = await query(`${ITEM_SELECT} WHERE m.id = $1`, [rows[0].id]);
    res.status(201).json(result[0]);
  } catch (err) {
    if (err.code === '23503') return res.status(400).json({ error: 'category_id does not exist' });
    next(err);
  }
});

// POST /api/menu/reorder — 商品の並び順を一括更新（同一カテゴリ/サブカテゴリ内のドラッグ&ドロップ用）
// body: { items: [{ id, sort_order }, ...] } — 全アイテムは同一 category_id + subcategory_id に属すること
router.post('/reorder', async (req, res, next) => {
  const { items = [] } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items array is required' });
  }
  for (const it of items) {
    if (it.id == null || it.sort_order == null || isNaN(Number(it.sort_order))) {
      return res.status(400).json({ error: 'each item requires id and sort_order' });
    }
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const ids = items.map((it) => it.id);
    const { rows: existing } = await client.query(
      'SELECT id, category_id, subcategory_id FROM menu_items WHERE id = ANY($1::int[])', [ids]
    );
    if (existing.length !== ids.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'One or more items not found' });
    }
    const groups = new Set(existing.map((r) => `${r.category_id}:${r.subcategory_id ?? 'null'}`));
    if (groups.size > 1) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'All items must belong to the same category and subcategory' });
    }

    const results = [];
    for (const it of items) {
      await client.query('UPDATE menu_items SET sort_order = $1 WHERE id = $2', [Number(it.sort_order), it.id]);
      results.push({ id: it.id, sort_order: Number(it.sort_order) });
    }

    await client.query('COMMIT');
    res.json({ updated: results.length, items: results });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// POST /api/menu/crash
router.post('/crash', async (req, res, next) => {
  try {
    const { category_ids = [], subcategory_ids = [] } = req.body;
    if (category_ids.length === 0 && subcategory_ids.length === 0) {
      return res.status(400).json({ error: 'category_ids or subcategory_ids required' });
    }

    const { rows: targets } = await query(`
      SELECT m.id,
        m.name,
        m.base_price::float,
        m.current_price::float,
        m.min_price::float,
        COALESCE((
          SELECT SUM(r.usage_quantity * i.cost_per_purchase_unit / NULLIF(i.purchase_quantity, 0))
          FROM recipes r JOIN ingredients i ON r.ingredient_id = i.id
          WHERE r.menu_item_id = m.id
        ), 0)::float AS cost,
        COALESCE(
          CASE WHEN m.subcategory_id = ANY($2::int[]) THEN sc.crash_pct::float ELSE NULL END,
          CASE WHEN m.category_id    = ANY($1::int[]) THEN c.crash_pct::float  ELSE NULL END
        ) AS effective_pct
      FROM menu_items m
      JOIN categories c ON m.category_id = c.id
      LEFT JOIN subcategories sc ON m.subcategory_id = sc.id
      WHERE m.crash_enabled = TRUE
        AND m.is_active = TRUE
        AND (m.category_id = ANY($1::int[]) OR m.subcategory_id = ANY($2::int[]))
    `, [category_ids, subcategory_ids]);

    let updated = 0;
    const broadcastItems = [];
    for (const item of targets) {
      const pct = Math.min(Math.max(item.effective_pct ?? 0, 0), 100);
      // セーフティネット: 原価がある商品は原価×1.2、原価不明(レシピ未登録)の商品は
      // base_price×40% を下限にする(25円切上げ)。これで全商品に必ず下限がかかる。
      const costFloor = item.cost > 0
        ? Math.ceil(item.cost * 1.2 / 25) * 25
        : Math.ceil(item.base_price * 0.4 / 25) * 25;
      const raw = Math.round(item.min_price * (1 - pct / 100) / 25) * 25;
      const crashPrice = Math.max(raw, costFloor, 0);
      await query(
        'UPDATE menu_items SET current_price = $1, is_crashed = TRUE WHERE id = $2',
        [crashPrice, item.id]
      );
      await query(
        'INSERT INTO price_history (menu_item_id, price) VALUES ($1, $2)',
        [item.id, crashPrice]
      );
      // 計装(1-1): 暴落イベントを永続記録（before=旧current, after=crashPrice）
      await query(
        `INSERT INTO price_events (menu_item_id, price_before, price_after, event_type, trigger)
         VALUES ($1, $2, $3, 'crash', 'crash_endpoint')`,
        [item.id, item.current_price, crashPrice]
      );
      const pctChange = item.base_price > 0
        ? Math.round((crashPrice - item.base_price) / item.base_price * 100 * 10) / 10
        : 0;
      broadcastItems.push({
        id: item.id,
        name: item.name,
        base_price: item.base_price,
        current_price: crashPrice,
        pct_change: pctChange,
        direction: 'down',
      });
      updated++;
    }

    if (updated > 0) {
      const startedAt = new Date().toISOString();
      await query(
        `INSERT INTO system_settings (key, value) VALUES ('crash_started_at', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [startedAt]
      );
      broadcast('prices:updated', { items: broadcastItems, timestamp: Date.now() });
      broadcast('crash:started', { category_ids, subcategory_ids, timestamp: Date.now() });
    }

    res.json({ updated });
  } catch (err) { next(err); }
});

// POST /api/menu/crash/reset
router.post('/crash/reset', async (req, res, next) => {
  try {
    // 計装(1-1): reset前に暴落中商品の現在価格を控える（before記録用）
    const { rows: beforeReset } = await query(
      `SELECT id, current_price::float AS current_price, base_price::float AS base_price
       FROM menu_items WHERE is_crashed = TRUE AND is_active = TRUE`
    );

    const { rows } = await query(`
      UPDATE menu_items
      SET current_price = base_price, is_crashed = FALSE
      WHERE is_crashed = TRUE AND is_active = TRUE
      RETURNING id
    `);

    // 計装(1-1): 暴落解除イベントを永続記録（before=暴落中価格, after=base_price）
    for (const b of beforeReset) {
      await query(
        `INSERT INTO price_events (menu_item_id, price_before, price_after, event_type, trigger)
         VALUES ($1, $2, $3, 'crash_reset', 'crash_endpoint')`,
        [b.id, b.current_price, b.base_price]
      );
    }

    if (rows.length > 0) {
      const { rows: allPrices } = await query(`
        SELECT id, name, base_price::float, current_price::float,
          COALESCE(ROUND((current_price - base_price) * 100.0 / NULLIF(base_price, 0), 1), 0)::float AS pct_change
        FROM menu_items WHERE is_drink = TRUE AND is_active = TRUE
      `);
      const items = allPrices.map((r) => ({
        ...r,
        direction: r.pct_change > 0 ? 'up' : r.pct_change < 0 ? 'down' : 'flat',
      }));
      await query(`DELETE FROM system_settings WHERE key = 'crash_started_at'`);
      broadcast('prices:updated', { items, timestamp: Date.now() });
      broadcast('crash:ended', { timestamp: Date.now() });
    }

    res.json({ updated: rows.length });
  } catch (err) { next(err); }
});

// POST /api/menu/crash/manual — 手動暴落（暴落ナイト用・フェーズ3）
// body: { scope: 'all' | 'category', category_ids?: number[] }
// 対象を base_price×率 まで急落（下限=原価×1.2 / 原価なし base×40% を絶対床として優先）。
// price_events に crash_manual を記録し、継続時間経過でサーバ自動解除（手動解除は /crash/reset）。
router.post('/crash/manual', async (req, res, next) => {
  try {
    const scope = req.body.scope === 'category' ? 'category' : 'all';
    const category_ids = Array.isArray(req.body.category_ids)
      ? req.body.category_ids.map(Number).filter(Number.isInteger)
      : [];
    if (scope === 'category' && category_ids.length === 0) {
      return res.status(400).json({ error: 'category_ids required when scope=category' });
    }

    const scopeFilter = scope === 'category' ? 'AND m.category_id = ANY($1::int[])' : '';
    const params = scope === 'category' ? [category_ids] : [];
    const { rows: targets } = await query(`
      SELECT m.id, m.name, m.base_price::float AS base_price, m.current_price::float AS current_price,
        m.min_price::float AS min_price, m.max_price::float AS max_price,
        COALESCE((
          SELECT SUM(r.usage_quantity * i.cost_per_purchase_unit / NULLIF(i.purchase_quantity, 0))
          FROM recipes r JOIN ingredients i ON r.ingredient_id = i.id
          WHERE r.menu_item_id = m.id
        ), 0)::float AS cost
      FROM menu_items m
      WHERE m.crash_enabled = TRUE AND m.is_active = TRUE AND m.is_drink = TRUE ${scopeFilter}
    `, params);

    let updated = 0;
    const broadcastItems = [];
    for (const item of targets) {
      // 暴落=最下段へ即時。可変商品は min_price、ロック(min=max)は原価床(原価×1.2 / base×40%)。
      // いずれも原価×1.2 を下回らない（min_price は再計算時に原価床以上で作られている）。
      const floor = pm.costFloor(item.base_price, item.cost);
      const crashPrice = item.min_price === item.max_price
        ? Math.max(floor, 0)
        : Math.max(item.min_price, floor, 0);
      if (crashPrice >= item.current_price) continue; // 既に最下段以下なら下げない
      await query('UPDATE menu_items SET current_price = $1, is_crashed = TRUE WHERE id = $2', [crashPrice, item.id]);
      await query('INSERT INTO price_history (menu_item_id, price) VALUES ($1, $2)', [item.id, crashPrice]);
      await query(
        `INSERT INTO price_events (menu_item_id, price_before, price_after, event_type, trigger)
         VALUES ($1, $2, $3, 'crash_manual', 'manual')`,
        [item.id, item.current_price, crashPrice]
      );
      broadcastItems.push({
        id: item.id, name: item.name, base_price: item.base_price, current_price: crashPrice,
        pct_change: item.base_price > 0 ? Math.round((crashPrice - item.base_price) / item.base_price * 1000) / 10 : 0,
        direction: 'down',
      });
      updated++;
    }

    let endsAtIso = null;
    if (updated > 0) {
      const startedAt = new Date();
      const endsAt = new Date(startedAt.getTime() + crashCfg.MANUAL_CRASH_DURATION_MS);
      endsAtIso = endsAt.toISOString();
      await query(
        `INSERT INTO system_settings (key, value) VALUES ('crash_started_at', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [startedAt.toISOString()]
      );
      await query(
        `INSERT INTO system_settings (key, value) VALUES ('crash_ends_at', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [endsAtIso]
      );
      broadcast('prices:updated', { items: broadcastItems, timestamp: Date.now() });
      broadcast('crash:started', {
        scope, category_ids, endsAt: endsAtIso,
        durationMs: crashCfg.MANUAL_CRASH_DURATION_MS, manual: true, timestamp: Date.now(),
      });
      // プロセス内の自動解除タイマー。再起動時はpricingEngine tickのcrash_ends_at検知が保険。
      if (_manualCrashTimer) clearTimeout(_manualCrashTimer);
      _manualCrashTimer = setTimeout(() => { performManualCrashReset('auto').catch(() => {}); }, crashCfg.MANUAL_CRASH_DURATION_MS);
    }

    res.json({ updated, endsAt: endsAtIso });
  } catch (err) { next(err); }
});

// PATCH /api/menu/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const { rows: existing } = await query(
      `SELECT m.id, m.min_price::float AS min_price, m.max_price::float AS max_price, m.is_crashed,
         m.base_price::float AS base_price, m.current_price::float AS current_price,
         m.is_drink, m.price_editable,
         COALESCE((SELECT SUM(r.usage_quantity * i.cost_per_purchase_unit / NULLIF(i.purchase_quantity, 0))
           FROM recipes r JOIN ingredients i ON r.ingredient_id = i.id WHERE r.menu_item_id = m.id), 0)::float AS cost
       FROM menu_items m WHERE m.id = $1`, [req.params.id]);
    if (!existing[0]) return res.status(404).json({ error: 'Item not found' });

    const { category_id, name, base_price, min_price, max_price, price_step_up, price_step_down,
            is_drink, is_active, subcategory_id, crash_enabled, is_crashed,
            image_url, tax_category, is_staff_only, price_editable, sort_order,
            question_text, question_choices, question_allow_multiple, question_allow_quantity } = req.body;
    const updates = [];
    const values = [];
    let idx = 1;

    // min/max の実効値（未指定なら既存値）。バリデーションと base 変更時の current_price クランプで共用
    const effectiveMin = min_price !== undefined ? Number(min_price) : existing[0].min_price;
    const effectiveMax = max_price !== undefined ? Number(max_price) : existing[0].max_price;
    if (effectiveMin > effectiveMax) {
      return res.status(400).json({ error: 'min_price must be less than or equal to max_price' });
    }

    if (category_id !== undefined) {
      if (!category_id) return res.status(400).json({ error: 'category_id must not be empty' });
      updates.push(`category_id = $${idx++}`); values.push(category_id);
    }
    if (name !== undefined)             { updates.push(`name = $${idx++}`);             values.push(name); }
    if (base_price !== undefined)       { updates.push(`base_price = $${idx++}`);       values.push(base_price); }
    // Phase4/5: 基準価格変更 or ロック切替 時は min/max/段/現在価格 を自動再計算（暴落中は据え置き）。
    // 食品/時価/ロックは固定価格(min=max)。手動 min/max/step 入力は使わない。
    let followedCurrentPrice = null; // 計装(1-1): 追従で更新した current_price（price_events記録用）
    let ladderUpdated = false;
    const recompute = base_price !== undefined || req.body.price_locked !== undefined;
    if (recompute && !existing[0].is_crashed) {
      const newBase = base_price !== undefined ? Number(base_price) : existing[0].base_price;
      const isDrinkEff = is_drink !== undefined ? Boolean(is_drink) : existing[0].is_drink;
      const priceEditableEff = price_editable !== undefined ? Boolean(price_editable) : existing[0].price_editable;
      const locked = req.body.price_locked !== undefined
        ? Boolean(req.body.price_locked)
        : (existing[0].min_price === existing[0].max_price);
      const L = computeLadder(newBase, existing[0].cost || 0, { locked, isDrink: isDrinkEff, priceEditable: priceEditableEff });
      updates.push(`min_price = $${idx++}`);       values.push(L.min);
      updates.push(`max_price = $${idx++}`);       values.push(L.max);
      updates.push(`price_step_up = $${idx++}`);   values.push(L.step);
      updates.push(`price_step_down = $${idx++}`); values.push(L.step);
      updates.push(`current_price = $${idx++}`);   values.push(L.current);
      followedCurrentPrice = L.current;
      ladderUpdated = true;
    }
    // 後方互換: 再計算しない場合のみ従来の手動 min/max/step を受ける
    if (!ladderUpdated) {
      if (min_price !== undefined)        { updates.push(`min_price = $${idx++}`);        values.push(min_price); }
      if (max_price !== undefined)        { updates.push(`max_price = $${idx++}`);        values.push(max_price); }
      if (price_step_up !== undefined)    { updates.push(`price_step_up = $${idx++}`);    values.push(price_step_up); }
      if (price_step_down !== undefined)  { updates.push(`price_step_down = $${idx++}`);  values.push(price_step_down); }
    }
    if (is_drink !== undefined)         { updates.push(`is_drink = $${idx++}`);         values.push(is_drink); }
    if (is_active !== undefined)        { updates.push(`is_active = $${idx++}`);        values.push(is_active); }
    if (subcategory_id !== undefined)   { updates.push(`subcategory_id = $${idx++}`);   values.push(subcategory_id || null); }
    if (crash_enabled !== undefined)    { updates.push(`crash_enabled = $${idx++}`);    values.push(crash_enabled); }
    if (is_crashed !== undefined)       { updates.push(`is_crashed = $${idx++}`);       values.push(is_crashed); }
    if (image_url !== undefined)        { updates.push(`image_url = $${idx++}`);        values.push(image_url || null); }
    if (tax_category !== undefined)    {
      if (!['standard', 'reduced'].includes(tax_category)) {
        return res.status(400).json({ error: 'tax_category must be standard or reduced' });
      }
      updates.push(`tax_category = $${idx++}`);
      values.push(tax_category);
    }
    if (is_staff_only !== undefined)   { updates.push(`is_staff_only = $${idx++}`);   values.push(Boolean(is_staff_only)); }
    if (price_editable !== undefined)  { updates.push(`price_editable = $${idx++}`);  values.push(Boolean(price_editable)); }
    if (sort_order !== undefined)      { updates.push(`sort_order = $${idx++}`);      values.push(sort_order); }
    if (question_text !== undefined || question_choices !== undefined) {
      let qText, qChoices;
      try {
        ({ qText, qChoices } = resolveQuestionConfig(question_text, question_choices));
      } catch (e) {
        if (e.status) return res.status(e.status).json({ error: e.error });
        throw e;
      }
      updates.push(`question_text = $${idx++}`);     values.push(qText);
      updates.push(`question_choices = $${idx++}`);  values.push(qChoices ? JSON.stringify(qChoices) : null);
      // 質問設定を更新する時は複数選択/数量指定フラグも合わせて設定（質問なしなら false 固定）
      updates.push(`question_allow_multiple = $${idx++}`); values.push(qText ? Boolean(question_allow_multiple) : false);
      updates.push(`question_allow_quantity = $${idx++}`); values.push(qText ? Boolean(question_allow_quantity) : false);
    }

    if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

    values.push(req.params.id);
    await query(`UPDATE menu_items SET ${updates.join(', ')} WHERE id = $${idx}`, values);

    // 計装(1-2): base_price が実際に変化したら履歴を記録（operatorは認証なしのためNULL）
    if (base_price !== undefined && Number(base_price) !== existing[0].base_price) {
      await query(
        `INSERT INTO base_price_history (menu_item_id, price_before, price_after, operator)
         VALUES ($1, $2, $3, NULL)`,
        [req.params.id, existing[0].base_price, Number(base_price)]
      );
    }
    // 計装(1-1): base追従で current_price を更新した場合、価格変動イベントを記録（base_edit）
    if (followedCurrentPrice !== null && followedCurrentPrice !== existing[0].current_price) {
      await query(
        `INSERT INTO price_events (menu_item_id, price_before, price_after, event_type, trigger)
         VALUES ($1, $2, $3, 'base_edit', 'menu_edit')`,
        [req.params.id, existing[0].current_price, followedCurrentPrice]
      );
    }

    const { rows: result } = await query(`${ITEM_SELECT} WHERE m.id = $1`, [req.params.id]);
    res.json(result[0]);
  } catch (err) {
    if (err.code === '23503') return res.status(400).json({ error: 'category_id does not exist' });
    next(err);
  }
});

// DELETE /api/menu/:id (soft delete)
router.delete('/:id', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT id FROM menu_items WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Item not found' });
    await query('UPDATE menu_items SET is_active = FALSE WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.startCrashWatcher = startCrashWatcher;
