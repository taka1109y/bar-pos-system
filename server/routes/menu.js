const express = require('express');
const router = express.Router();
const { query } = require('../db/database');
const { broadcast } = require('../services/socketService');

const ITEM_SELECT = `
  SELECT m.id, m.category_id, m.subcategory_id, m.name,
    m.base_price::float, m.current_price::float,
    m.min_price::float, m.max_price::float,
    m.price_step_up::float, m.price_step_down::float,
    COALESCE((
      SELECT SUM(r.usage_quantity * i.cost_per_purchase_unit / NULLIF(i.purchase_quantity, 0))
      FROM recipes r JOIN ingredients i ON r.ingredient_id = i.id
      WHERE r.menu_item_id = m.id
    ), 0)::float AS cost_price,
    m.recipe_notes,
    m.is_drink, m.is_active, m.crash_enabled, m.is_crashed,
    m.image_url, m.tax_category, m.is_staff_only, m.price_editable,
    c.name  AS category_name,  c.sort_order,
    sc.name AS subcategory_name, sc.sort_order AS subcategory_sort_order
  FROM menu_items m
  JOIN categories c ON m.category_id = c.id
  LEFT JOIN subcategories sc ON m.subcategory_id = sc.id
`;

// ─── カテゴリ ────────────────────────────────────────

// GET /api/menu/categories
router.get('/categories', async (req, res, next) => {
  try {
    const includeStaff = req.query.staff === 'true';
    const staffFilter  = includeStaff ? '' : 'WHERE is_staff_only = FALSE';
    const { rows } = await query(
      `SELECT id, name, sort_order, crash_pct::float, is_staff_only
       FROM categories ${staffFilter} ORDER BY sort_order`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// POST /api/menu/categories
router.post('/categories', async (req, res, next) => {
  try {
    const { name, sort_order = 0, is_staff_only = false } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const { rows } = await query(
      'INSERT INTO categories (name, sort_order, is_staff_only) VALUES ($1, $2, $3) RETURNING id, name, sort_order, crash_pct::float, is_staff_only',
      [name, sort_order, Boolean(is_staff_only)]
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// PATCH /api/menu/categories/:id
router.patch('/categories/:id', async (req, res, next) => {
  try {
    const { rows: existing } = await query('SELECT id FROM categories WHERE id = $1', [req.params.id]);
    if (!existing[0]) return res.status(404).json({ error: 'Category not found' });

    const { name, sort_order, crash_pct, is_staff_only } = req.body;
    const updates = [];
    const values = [];
    let idx = 1;
    if (name !== undefined)          { updates.push(`name = $${idx++}`);          values.push(name); }
    if (sort_order !== undefined)    { updates.push(`sort_order = $${idx++}`);    values.push(sort_order); }
    if (crash_pct !== undefined)     { updates.push(`crash_pct = $${idx++}`);     values.push(crash_pct); }
    if (is_staff_only !== undefined) { updates.push(`is_staff_only = $${idx++}`); values.push(Boolean(is_staff_only)); }
    if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

    values.push(req.params.id);
    const { rows } = await query(
      `UPDATE categories SET ${updates.join(', ')} WHERE id = $${idx} RETURNING id, name, sort_order, crash_pct::float, is_staff_only`,
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
      `${ITEM_SELECT} WHERE m.is_active = TRUE ${staffFilter} ORDER BY c.sort_order, sc.sort_order NULLS LAST, m.name`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /api/menu/all
router.get('/all', async (req, res, next) => {
  try {
    const { rows } = await query(
      `${ITEM_SELECT} ORDER BY c.sort_order, sc.sort_order NULLS LAST, m.name`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// POST /api/menu
router.post('/', async (req, res, next) => {
  try {
    const { category_id, subcategory_id, name, base_price, min_price, max_price,
            price_step_up, price_step_down, is_drink = true, image_url = null,
            tax_category, is_staff_only = false, price_editable = false } = req.body;
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
    const minP   = min_price        ?? base_price * 0.7;
    const maxP   = max_price        ?? base_price * 2.0;
    const stepUp = price_step_up   ?? 50;
    const stepDn = price_step_down ?? 25;
    const { rows } = await query(
      `INSERT INTO menu_items
         (category_id, subcategory_id, name, base_price, current_price, min_price, max_price, price_step_up, price_step_down, is_drink, image_url, tax_category, is_staff_only, price_editable)
       VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id`,
      [category_id, subcategory_id || null, name.trim(), base_price, minP, maxP, stepUp, stepDn, is_drink, image_url || null, effectiveTaxCategory, Boolean(is_staff_only), Boolean(price_editable)]
    );
    const { rows: result } = await query(`${ITEM_SELECT} WHERE m.id = $1`, [rows[0].id]);
    res.status(201).json(result[0]);
  } catch (err) {
    if (err.code === '23503') return res.status(400).json({ error: 'category_id does not exist' });
    next(err);
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
        m.min_price::float,
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
      const crashPrice = Math.max(Math.round(item.min_price * (1 - pct / 100) / 25) * 25, 0);
      await query(
        'UPDATE menu_items SET current_price = $1, is_crashed = TRUE WHERE id = $2',
        [crashPrice, item.id]
      );
      await query(
        'INSERT INTO price_history (menu_item_id, price) VALUES ($1, $2)',
        [item.id, crashPrice]
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
    const { rows } = await query(`
      UPDATE menu_items
      SET current_price = base_price, is_crashed = FALSE
      WHERE is_crashed = TRUE AND is_active = TRUE
      RETURNING id
    `);

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

// PATCH /api/menu/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const { rows: existing } = await query('SELECT id FROM menu_items WHERE id = $1', [req.params.id]);
    if (!existing[0]) return res.status(404).json({ error: 'Item not found' });

    const { name, base_price, min_price, max_price, price_step_up, price_step_down,
            is_drink, is_active, subcategory_id, crash_enabled, is_crashed,
            image_url, tax_category, is_staff_only, price_editable } = req.body;
    const updates = [];
    const values = [];
    let idx = 1;

    if (name !== undefined)             { updates.push(`name = $${idx++}`);             values.push(name); }
    if (base_price !== undefined)       { updates.push(`base_price = $${idx++}`);       values.push(base_price); }
    if (min_price !== undefined)        { updates.push(`min_price = $${idx++}`);        values.push(min_price); }
    if (max_price !== undefined)        { updates.push(`max_price = $${idx++}`);        values.push(max_price); }
    if (price_step_up !== undefined)    { updates.push(`price_step_up = $${idx++}`);    values.push(price_step_up); }
    if (price_step_down !== undefined)  { updates.push(`price_step_down = $${idx++}`);  values.push(price_step_down); }
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

    if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

    values.push(req.params.id);
    await query(`UPDATE menu_items SET ${updates.join(', ')} WHERE id = $${idx}`, values);

    const { rows: result } = await query(`${ITEM_SELECT} WHERE m.id = $1`, [req.params.id]);
    res.json(result[0]);
  } catch (err) { next(err); }
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
