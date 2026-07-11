const express = require('express');
const router = express.Router();
const { query } = require('../db/database');
const { broadcast } = require('../services/socketService');
const { TZ, todayJST } = require('../utils/time');
const { assertDateFormat } = require('../utils/validate');

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
        oi.selected_option,
        o.table_id,
        t.name            AS table_name
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      JOIN tables t ON t.id = o.table_id
      WHERE o.status = 'open' AND oi.status = 'pending'
      ORDER BY oi.created_at ASC, oi.id ASC
    `);

    res.json(rows.map((r) => ({
      itemId:         r.item_id,
      orderId:        r.order_id,
      menuItemId:     r.menu_item_id,
      tableId:        r.table_id,
      tableName:      r.table_name,
      itemName:       r.item_name,
      quantity:       r.quantity,
      status:         r.item_status,
      orderedAt:      r.ordered_at,
      selectedOption: r.selected_option,
    })));
  } catch (err) {
    next(err);
  }
});

// GET /api/kitchen/history — 当日(レジオープン以降)の提供済み一覧
router.get('/history', async (req, res, next) => {
  try {
    const date = req.query.date || todayJST();
    assertDateFormat(date, 'date');
    const since = req.query.since || null;

    const baseWhere = since
      ? `oi.status = 'served' AND (oi.created_at AT TIME ZONE $2)::date = $1 AND oi.created_at >= $3`
      : `oi.status = 'served' AND (oi.created_at AT TIME ZONE $2)::date = $1`;
    const params = since ? [date, TZ, since] : [date, TZ];

    const { rows } = await query(`
      SELECT
        oi.id             AS item_id,
        oi.order_id,
        oi.menu_item_id,
        oi.item_name,
        oi.quantity,
        oi.status         AS item_status,
        oi.created_at     AS ordered_at,
        oi.selected_option,
        o.table_id,
        t.name            AS table_name
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      JOIN tables t ON t.id = o.table_id
      WHERE ${baseWhere}
      ORDER BY oi.created_at DESC
    `, params);

    res.json(rows.map((r) => ({
      itemId:         r.item_id,
      orderId:        r.order_id,
      menuItemId:     r.menu_item_id,
      tableId:        r.table_id,
      tableName:      r.table_name,
      itemName:       r.item_name,
      quantity:       r.quantity,
      status:         r.item_status,
      orderedAt:      r.ordered_at,
      selectedOption: r.selected_option,
    })));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.error });
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
