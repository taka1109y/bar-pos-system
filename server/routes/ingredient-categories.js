const express = require('express');
const router = express.Router();
const { query } = require('../db/database');

// GET /api/ingredient-categories — 材料カテゴリ一覧（有効なもの・並び順）
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT id, name, sort_order, is_active, created_at
      FROM ingredient_categories
      WHERE is_active = TRUE
      ORDER BY sort_order, name
    `);
    res.json(rows);
  } catch (err) { next(err); }
});

// POST /api/ingredient-categories — 新規作成
router.post('/', async (req, res, next) => {
  try {
    const { name, sort_order } = req.body;
    if (!name || String(name).trim().length === 0) {
      return res.status(400).json({ error: 'name is required' });
    }
    // sort_order 未指定なら末尾（既存最大+1）
    let order = Number(sort_order);
    if (sort_order === undefined || Number.isNaN(order)) {
      const { rows: mx } = await query('SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM ingredient_categories');
      order = mx[0].next;
    }
    const { rows } = await query(`
      INSERT INTO ingredient_categories (name, sort_order)
      VALUES ($1, $2)
      RETURNING id, name, sort_order, is_active, created_at
    `, [name.trim(), order]);
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: '同名のカテゴリが既に存在します' });
    next(err);
  }
});

// PATCH /api/ingredient-categories/:id — 更新（name / sort_order / is_active）
router.patch('/:id', async (req, res, next) => {
  try {
    const { rows: existing } = await query('SELECT id FROM ingredient_categories WHERE id = $1 AND is_active = TRUE', [req.params.id]);
    if (!existing[0]) return res.status(404).json({ error: 'Ingredient category not found' });

    const { name, sort_order, is_active } = req.body;
    const updates = [];
    const values = [];
    let idx = 1;
    if (name !== undefined)       { updates.push(`name = $${idx++}`);       values.push(String(name).trim()); }
    if (sort_order !== undefined) { updates.push(`sort_order = $${idx++}`); values.push(Number(sort_order) || 0); }
    if (is_active !== undefined)  { updates.push(`is_active = $${idx++}`);  values.push(Boolean(is_active)); }
    if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

    values.push(req.params.id);
    const { rows } = await query(`
      UPDATE ingredient_categories SET ${updates.join(', ')} WHERE id = $${idx}
      RETURNING id, name, sort_order, is_active, created_at
    `, values);
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: '同名のカテゴリが既に存在します' });
    next(err);
  }
});

// DELETE /api/ingredient-categories/:id — 物理削除
// カテゴリは履歴参照を持たない純粋なラベルなので物理削除でよい（menu_items/ingredients の
// ような論理削除は不要）。参照している材料は FK(ON DELETE SET NULL)で自動的に未分類へ戻る。
// 物理削除にすることで、削除した名称を後から再作成できる（UNIQUE(name) の残留を避ける）。
router.delete('/:id', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT id FROM ingredient_categories WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Ingredient category not found' });
    await query('DELETE FROM ingredient_categories WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
