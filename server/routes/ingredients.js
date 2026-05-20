const express = require('express');
const router = express.Router();
const { query } = require('../db/database');

// GET /api/ingredients — 材料一覧（在庫情報含む）
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT
        i.id, i.name, i.purchase_unit, i.purchase_quantity::float,
        i.quantity_unit, i.cost_per_purchase_unit::float,
        i.is_active, i.created_at,
        s.quantity_current::float,
        s.last_updated
      FROM ingredients i
      LEFT JOIN ingredient_stock s ON s.ingredient_id = i.id
      WHERE i.is_active = TRUE
      ORDER BY i.name
    `);
    res.json(rows);
  } catch (err) { next(err); }
});

// POST /api/ingredients — 材料新規作成
router.post('/', async (req, res, next) => {
  try {
    const { name, purchase_unit = '本', purchase_quantity = 1,
            quantity_unit = 'ml', cost_per_purchase_unit = 0 } = req.body;
    if (!name || String(name).trim().length === 0) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (Number(purchase_quantity) <= 0) {
      return res.status(400).json({ error: 'purchase_quantity must be > 0' });
    }
    const { rows } = await query(`
      INSERT INTO ingredients (name, purchase_unit, purchase_quantity, quantity_unit, cost_per_purchase_unit)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, name, purchase_unit, purchase_quantity::float, quantity_unit, cost_per_purchase_unit::float, is_active, created_at
    `, [name.trim(), purchase_unit, Number(purchase_quantity), quantity_unit, Number(cost_per_purchase_unit) || 0]);
    res.status(201).json({ ...rows[0], quantity_current: null, last_updated: null });
  } catch (err) { next(err); }
});

// PATCH /api/ingredients/:id — 材料更新
router.patch('/:id', async (req, res, next) => {
  try {
    const { rows: existing } = await query('SELECT id FROM ingredients WHERE id = $1 AND is_active = TRUE', [req.params.id]);
    if (!existing[0]) return res.status(404).json({ error: 'Ingredient not found' });

    const { name, purchase_unit, purchase_quantity, quantity_unit, cost_per_purchase_unit } = req.body;
    const updates = [];
    const values = [];
    let idx = 1;
    if (name !== undefined)                  { updates.push(`name = $${idx++}`);                  values.push(name.trim()); }
    if (purchase_unit !== undefined)         { updates.push(`purchase_unit = $${idx++}`);         values.push(purchase_unit); }
    if (purchase_quantity !== undefined)     { updates.push(`purchase_quantity = $${idx++}`);     values.push(Number(purchase_quantity)); }
    if (quantity_unit !== undefined)         { updates.push(`quantity_unit = $${idx++}`);         values.push(quantity_unit); }
    if (cost_per_purchase_unit !== undefined){ updates.push(`cost_per_purchase_unit = $${idx++}`); values.push(Number(cost_per_purchase_unit) || 0); }
    if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

    values.push(req.params.id);
    const { rows } = await query(`
      UPDATE ingredients SET ${updates.join(', ')} WHERE id = $${idx}
      RETURNING id, name, purchase_unit, purchase_quantity::float, quantity_unit, cost_per_purchase_unit::float, is_active
    `, values);
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// DELETE /api/ingredients/:id — 論理削除
router.delete('/:id', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT id FROM ingredients WHERE id = $1 AND is_active = TRUE', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Ingredient not found' });
    await query('UPDATE ingredients SET is_active = FALSE WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
