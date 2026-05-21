const express = require('express');
const router = express.Router();
const { query } = require('../db/database');
const { broadcast } = require('../services/socketService');

// GET /api/kitchen/orders — pending なアイテムを行リストで返す
router.get('/orders', async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT
        oi.id             AS item_id,
        oi.order_id,
        oi.menu_item_id,
        oi.item_name,
        oi.quantity,
        oi.status         AS item_status,
        oi.created_at     AS ordered_at,
        o.table_id,
        t.name            AS table_name
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      JOIN tables t ON t.id = o.table_id
      WHERE o.status = 'open' AND oi.status = 'pending'
      ORDER BY oi.created_at ASC, oi.id ASC
    `);

    res.json(rows.map((r) => ({
      itemId:      r.item_id,
      orderId:     r.order_id,
      menuItemId:  r.menu_item_id,
      tableId:     r.table_id,
      tableName:   r.table_name,
      itemName:    r.item_name,
      quantity:    r.quantity,
      status:      r.item_status,
      orderedAt:   r.ordered_at,
    })));
  } catch (err) {
    next(err);
  }
});

// PATCH /api/kitchen/items/:itemId/serve — 提供完了
router.patch('/items/:itemId/serve', async (req, res, next) => {
  try {
    const { rows } = await query(
      `UPDATE order_items SET status = 'served' WHERE id = $1 AND status = 'pending' RETURNING id, order_id`,
      [req.params.itemId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Item not found or already served' });

    broadcast('kitchen:item_served', { itemId: rows[0].id, orderId: rows[0].order_id });
    res.json({ itemId: rows[0].id });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
