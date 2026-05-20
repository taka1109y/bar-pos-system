const express = require('express');
const router = express.Router();
const { pool, query } = require('../db/database');

// GET /api/inventory — 材料在庫一覧
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT
        i.id AS ingredient_id,
        i.name, i.purchase_unit, i.purchase_quantity::float,
        i.quantity_unit, i.cost_per_purchase_unit::float,
        s.id, s.quantity_current::float, s.last_updated
      FROM ingredients i
      LEFT JOIN ingredient_stock s ON s.ingredient_id = i.id
      WHERE i.is_active = TRUE
      ORDER BY i.name
    `);
    res.json(rows);
  } catch (err) { next(err); }
});

// POST /api/inventory/:ingredientId/init — 初期在庫設定（upsert）
router.post('/:ingredientId/init', async (req, res, next) => {
  try {
    const { quantity = 0 } = req.body;
    const ingredientId = parseInt(req.params.ingredientId, 10);

    const { rows: existing } = await query(
      'SELECT id FROM ingredients WHERE id = $1 AND is_active = TRUE', [ingredientId]
    );
    if (!existing[0]) return res.status(404).json({ error: 'Ingredient not found' });

    const { rows } = await query(`
      INSERT INTO ingredient_stock (ingredient_id, quantity_current)
      VALUES ($1, $2)
      ON CONFLICT (ingredient_id) DO UPDATE
        SET quantity_current = $2, last_updated = NOW()
      RETURNING id, ingredient_id, quantity_current::float, last_updated
    `, [ingredientId, Math.max(0, Number(quantity) || 0)]);

    res.json(rows[0]);
  } catch (err) { next(err); }
});

// POST /api/inventory/adjust — 棚卸し調整（実在庫入力 → 差分ログ記録）
// body: { adjustments: [{ ingredient_id, actual_quantity, note }] }
router.post('/adjust', async (req, res, next) => {
  const { adjustments = [] } = req.body;
  if (!Array.isArray(adjustments) || adjustments.length === 0) {
    return res.status(400).json({ error: 'adjustments array is required' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const results = [];
    for (const adj of adjustments) {
      const { ingredient_id, actual_quantity, note = null } = adj;
      if (ingredient_id == null || actual_quantity == null) continue;
      const { rows: stock } = await client.query(
        'SELECT id, quantity_current FROM ingredient_stock WHERE ingredient_id = $1',
        [ingredient_id]
      );
      if (stock.length === 0) continue;
      const before = parseFloat(stock[0].quantity_current);
      const after  = Math.max(0, Number(actual_quantity));
      const change = after - before;
      await client.query(
        'UPDATE ingredient_stock SET quantity_current = $1, last_updated = NOW() WHERE ingredient_id = $2',
        [after, ingredient_id]
      );
      await client.query(
        `INSERT INTO ingredient_stock_logs (ingredient_id, quantity_before, quantity_after, quantity_change, reason, note)
         VALUES ($1, $2, $3, $4, 'adjustment', $5)`,
        [ingredient_id, before, after, change, note]
      );
      results.push({ ingredient_id, before, after, change });
    }
    await client.query('COMMIT');
    res.json({ adjusted: results.length, results });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// POST /api/inventory/purchase — 仕入れ入力（在庫追加）
// body: { ingredient_id, quantity, note }
router.post('/purchase', async (req, res, next) => {
  const { ingredient_id, quantity, note = null } = req.body;
  if (!ingredient_id || !quantity || Number(quantity) <= 0) {
    return res.status(400).json({ error: 'ingredient_id and positive quantity are required' });
  }
  const client = await pool.connect();
  try {
    const { rows: stock } = await client.query(
      'SELECT id, quantity_current FROM ingredient_stock WHERE ingredient_id = $1',
      [ingredient_id]
    );
    if (stock.length === 0) return res.status(404).json({ error: 'Inventory record not found. Initialize first.' });

    await client.query('BEGIN');
    const before = parseFloat(stock[0].quantity_current);
    const after  = before + Number(quantity);
    await client.query(
      'UPDATE ingredient_stock SET quantity_current = $1, last_updated = NOW() WHERE ingredient_id = $2',
      [after, ingredient_id]
    );
    await client.query(
      `INSERT INTO ingredient_stock_logs (ingredient_id, quantity_before, quantity_after, quantity_change, reason, note)
       VALUES ($1, $2, $3, $4, 'purchase', $5)`,
      [ingredient_id, before, after, Number(quantity), note]
    );
    await client.query('COMMIT');
    res.json({ ingredient_id, before, after, added: Number(quantity) });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// GET /api/inventory/logs — 異動ログ一覧
router.get('/logs', async (req, res, next) => {
  try {
    const { ingredient_id, from, to, reason, limit = 100 } = req.query;
    const conditions = [];
    const params = [];
    let idx = 1;
    if (ingredient_id) { conditions.push(`l.ingredient_id = $${idx++}`); params.push(parseInt(ingredient_id, 10)); }
    if (reason)        { conditions.push(`l.reason = $${idx++}`);        params.push(reason); }
    if (from)          { conditions.push(`l.log_date >= $${idx++}`);     params.push(from); }
    if (to)            { conditions.push(`l.log_date < ($${idx++}::date + interval '1 day')`); params.push(to); }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(Math.min(parseInt(limit, 10) || 100, 500));
    const { rows } = await query(`
      SELECT l.id, l.ingredient_id, i.name AS ingredient_name, i.quantity_unit,
        l.quantity_before::float, l.quantity_after::float, l.quantity_change::float,
        l.reason, l.related_order_id, l.note, l.log_date
      FROM ingredient_stock_logs l
      JOIN ingredients i ON l.ingredient_id = i.id
      ${where}
      ORDER BY l.log_date DESC
      LIMIT $${idx}
    `, params);
    res.json(rows);
  } catch (err) { next(err); }
});

module.exports = router;
