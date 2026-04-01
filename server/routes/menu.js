const express = require('express');
const router = express.Router();
const { query } = require('../db/database');

const ITEM_SELECT = `
  SELECT m.id, m.category_id, m.subcategory_id, m.name,
    m.base_price::float, m.current_price::float,
    m.min_price::float, m.max_price::float,
    m.is_drink, m.is_active,
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
    const { rows } = await query('SELECT * FROM categories ORDER BY sort_order');
    res.json(rows);
  } catch (err) { next(err); }
});

// POST /api/menu/categories
router.post('/categories', async (req, res, next) => {
  try {
    const { name, sort_order = 0 } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const { rows } = await query(
      'INSERT INTO categories (name, sort_order) VALUES ($1, $2) RETURNING *',
      [name, sort_order]
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// PATCH /api/menu/categories/:id
router.patch('/categories/:id', async (req, res, next) => {
  try {
    const { rows: existing } = await query('SELECT id FROM categories WHERE id = $1', [req.params.id]);
    if (!existing[0]) return res.status(404).json({ error: 'Category not found' });

    const { name, sort_order } = req.body;
    const updates = [];
    const values = [];
    let idx = 1;
    if (name !== undefined)       { updates.push(`name = $${idx++}`);       values.push(name); }
    if (sort_order !== undefined) { updates.push(`sort_order = $${idx++}`); values.push(sort_order); }
    if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

    values.push(req.params.id);
    const { rows } = await query(
      `UPDATE categories SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
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
      SELECT sc.*, c.name AS category_name
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
      'INSERT INTO subcategories (category_id, name, sort_order) VALUES ($1, $2, $3) RETURNING *',
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

    const { name, sort_order, category_id } = req.body;
    const updates = [];
    const values = [];
    let idx = 1;
    if (name !== undefined)        { updates.push(`name = $${idx++}`);        values.push(name); }
    if (sort_order !== undefined)  { updates.push(`sort_order = $${idx++}`);  values.push(sort_order); }
    if (category_id !== undefined) { updates.push(`category_id = $${idx++}`); values.push(category_id); }
    if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

    values.push(req.params.id);
    const { rows } = await query(
      `UPDATE subcategories SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
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

// GET /api/menu (アクティブのみ)
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await query(
      `${ITEM_SELECT} WHERE m.is_active = TRUE ORDER BY c.sort_order, sc.sort_order NULLS LAST, m.name`
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
    const { category_id, subcategory_id, name, base_price, min_price, max_price, is_drink = true } = req.body;
    if (!category_id || !name || base_price == null) {
      return res.status(400).json({ error: 'category_id, name, base_price are required' });
    }
    if (typeof name !== 'string' || name.trim().length === 0 || name.length > 100) {
      return res.status(400).json({ error: 'name must be 1-100 characters' });
    }
    if (isNaN(Number(base_price)) || Number(base_price) < 0) {
      return res.status(400).json({ error: 'base_price must be a non-negative number' });
    }
    const minP = min_price ?? base_price * 0.7;
    const maxP = max_price ?? base_price * 2.0;
    const { rows } = await query(
      `INSERT INTO menu_items (category_id, subcategory_id, name, base_price, current_price, min_price, max_price, is_drink)
       VALUES ($1, $2, $3, $4, $4, $5, $6, $7)
       RETURNING id`,
      [category_id, subcategory_id || null, name.trim(), base_price, minP, maxP, is_drink]
    );
    const { rows: result } = await query(`${ITEM_SELECT} WHERE m.id = $1`, [rows[0].id]);
    res.status(201).json(result[0]);
  } catch (err) {
    if (err.code === '23503') return res.status(400).json({ error: 'category_id does not exist' });
    next(err);
  }
});

// PATCH /api/menu/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const { rows: existing } = await query('SELECT id FROM menu_items WHERE id = $1', [req.params.id]);
    if (!existing[0]) return res.status(404).json({ error: 'Item not found' });

    const { name, base_price, min_price, max_price, is_drink, is_active, subcategory_id } = req.body;
    const updates = [];
    const values = [];
    let idx = 1;

    if (name !== undefined)           { updates.push(`name = $${idx++}`);           values.push(name); }
    if (base_price !== undefined)     { updates.push(`base_price = $${idx++}`);     values.push(base_price); }
    if (min_price !== undefined)      { updates.push(`min_price = $${idx++}`);      values.push(min_price); }
    if (max_price !== undefined)      { updates.push(`max_price = $${idx++}`);      values.push(max_price); }
    if (is_drink !== undefined)       { updates.push(`is_drink = $${idx++}`);       values.push(is_drink); }
    if (is_active !== undefined)      { updates.push(`is_active = $${idx++}`);      values.push(is_active); }
    if (subcategory_id !== undefined) { updates.push(`subcategory_id = $${idx++}`); values.push(subcategory_id || null); }

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
