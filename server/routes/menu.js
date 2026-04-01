const express = require('express');
const router = express.Router();
const { query } = require('../db/database');

// GET /api/menu
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT m.id, m.category_id, m.name,
        m.base_price::float, m.current_price::float,
        m.min_price::float, m.max_price::float,
        m.is_drink, m.is_active,
        c.name as category_name, c.sort_order
      FROM menu_items m
      JOIN categories c ON m.category_id = c.id
      WHERE m.is_active = TRUE
      ORDER BY c.sort_order, m.name
    `);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/menu/all
router.get('/all', async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT m.id, m.category_id, m.name,
        m.base_price::float, m.current_price::float,
        m.min_price::float, m.max_price::float,
        m.is_drink, m.is_active,
        c.name as category_name, c.sort_order
      FROM menu_items m
      JOIN categories c ON m.category_id = c.id
      ORDER BY c.sort_order, m.name
    `);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/menu/categories
router.get('/categories', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM categories ORDER BY sort_order');
    res.json(rows);
  } catch (err) {
    next(err);
  }
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
  } catch (err) {
    next(err);
  }
});

// POST /api/menu
router.post('/', async (req, res, next) => {
  try {
    const { category_id, name, base_price, min_price, max_price, is_drink = true } = req.body;
    if (!category_id || !name || base_price == null) {
      return res.status(400).json({ error: 'category_id, name, base_price are required' });
    }
    const minP = min_price ?? base_price * 0.7;
    const maxP = max_price ?? base_price * 2.0;
    const { rows } = await query(
      `INSERT INTO menu_items (category_id, name, base_price, current_price, min_price, max_price, is_drink)
       VALUES ($1, $2, $3, $3, $4, $5, $6) RETURNING *`,
      [category_id, name, base_price, minP, maxP, is_drink]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/menu/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const { rows: existing } = await query('SELECT id FROM menu_items WHERE id = $1', [req.params.id]);
    if (!existing[0]) return res.status(404).json({ error: 'Item not found' });

    const { name, base_price, min_price, max_price, is_drink, is_active } = req.body;
    const updates = [];
    const values = [];
    let idx = 1;

    if (name !== undefined) { updates.push(`name = $${idx++}`); values.push(name); }
    if (base_price !== undefined) { updates.push(`base_price = $${idx++}`); values.push(base_price); }
    if (min_price !== undefined) { updates.push(`min_price = $${idx++}`); values.push(min_price); }
    if (max_price !== undefined) { updates.push(`max_price = $${idx++}`); values.push(max_price); }
    if (is_drink !== undefined) { updates.push(`is_drink = $${idx++}`); values.push(is_drink); }
    if (is_active !== undefined) { updates.push(`is_active = $${idx++}`); values.push(is_active); }

    if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

    values.push(req.params.id);
    const { rows } = await query(
      `UPDATE menu_items SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    res.json(rows[0]);
  } catch (err) {
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
  } catch (err) {
    next(err);
  }
});

module.exports = router;
