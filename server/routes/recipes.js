const express = require('express');
const router = express.Router();
const { pool, query } = require('../db/database');

// 商品1件のレシピ（材料リスト + recipe_notes）を返すヘルパー
async function fetchRecipeForMenu(menuItemId) {
  const { rows: item } = await query(
    'SELECT id, name, recipe_notes FROM menu_items WHERE id = $1 AND is_active = TRUE',
    [menuItemId]
  );
  if (!item[0]) return null;

  const { rows: ingredients } = await query(`
    SELECT r.id, r.ingredient_id, r.usage_quantity::float,
      i.name AS ingredient_name, i.quantity_unit,
      i.purchase_quantity::float, i.cost_per_purchase_unit::float,
      ROUND(r.usage_quantity * i.cost_per_purchase_unit / NULLIF(i.purchase_quantity, 0), 2)::float AS cost_contribution
    FROM recipes r
    JOIN ingredients i ON r.ingredient_id = i.id
    WHERE r.menu_item_id = $1
    ORDER BY i.name
  `, [menuItemId]);

  const total_cost = ingredients.reduce((s, r) => s + (r.cost_contribution || 0), 0);

  return {
    menu_item_id: item[0].id,
    menu_item_name: item[0].name,
    recipe_notes: item[0].recipe_notes,
    ingredients,
    total_cost: Math.round(total_cost * 100) / 100,
  };
}

// GET /api/recipes — 全商品のレシピ一覧
router.get('/', async (req, res, next) => {
  try {
    const { rows: items } = await query(
      `SELECT m.id, m.name, m.base_price::float, m.recipe_notes,
        COALESCE((
          SELECT SUM(r.usage_quantity * i.cost_per_purchase_unit / NULLIF(i.purchase_quantity, 0))
          FROM recipes r JOIN ingredients i ON r.ingredient_id = i.id
          WHERE r.menu_item_id = m.id
        ), 0)::float AS cost_price,
        c.name AS category_name
       FROM menu_items m
       JOIN categories c ON m.category_id = c.id
       LEFT JOIN subcategories sc ON m.subcategory_id = sc.id
       WHERE m.is_active = TRUE
       ORDER BY c.sort_order, sc.sort_order NULLS LAST, m.sort_order, m.name`
    );
    res.json(items);
  } catch (err) { next(err); }
});

// GET /api/recipes/menu/:menuItemId — 特定商品のレシピ詳細
router.get('/menu/:menuItemId', async (req, res, next) => {
  try {
    const recipe = await fetchRecipeForMenu(parseInt(req.params.menuItemId, 10));
    if (!recipe) return res.status(404).json({ error: 'Menu item not found' });
    res.json(recipe);
  } catch (err) { next(err); }
});

// PUT /api/recipes/menu/:menuItemId — レシピ一括更新（ingredients配列+recipe_notes）
// body: { recipe_notes, ingredients: [{ ingredient_id, usage_quantity }] }
router.put('/menu/:menuItemId', async (req, res, next) => {
  const menuItemId = parseInt(req.params.menuItemId, 10);
  const { recipe_notes = null, ingredients = [] } = req.body;

  const client = await pool.connect();
  try {
    const { rows: item } = await client.query(
      'SELECT id FROM menu_items WHERE id = $1 AND is_active = TRUE', [menuItemId]
    );
    if (!item[0]) return res.status(404).json({ error: 'Menu item not found' });

    await client.query('BEGIN');

    await client.query(
      'UPDATE menu_items SET recipe_notes = $1 WHERE id = $2',
      [recipe_notes || null, menuItemId]
    );

    await client.query('DELETE FROM recipes WHERE menu_item_id = $1', [menuItemId]);

    for (const ing of ingredients) {
      if (!ing.ingredient_id || !ing.usage_quantity || Number(ing.usage_quantity) <= 0) continue;
      await client.query(
        'INSERT INTO recipes (menu_item_id, ingredient_id, usage_quantity) VALUES ($1, $2, $3)',
        [menuItemId, ing.ingredient_id, Number(ing.usage_quantity)]
      );
    }

    await client.query('COMMIT');

    const recipe = await fetchRecipeForMenu(menuItemId);
    res.json(recipe);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;
