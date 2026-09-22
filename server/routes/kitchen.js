const express = require('express');
const router = express.Router();
const { query } = require('../db/database');
const { broadcast } = require('../services/socketService');
const { TZ, todayJST } = require('../utils/time');
const { assertDateFormat } = require('../utils/validate');

// order_items + orders + tables の共通カラムリストとレスポンス整形（GET /orders, GET /history で共用）
const KITCHEN_ITEM_COLUMNS = `
  oi.id             AS item_id,
  oi.order_id,
  oi.menu_item_id,
  oi.item_name,
  oi.quantity,
  oi.status         AS item_status,
  oi.created_at     AS ordered_at,
  oi.selected_option,
  o.table_id,
  o.status          AS order_status,
  t.name            AS table_name
`;

function mapKitchenRow(r) {
  return {
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
    orderStatus:    r.order_status,
  };
}

// GET /api/kitchen/orders — pending なアイテムを行リストで返す
router.get('/orders', async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT ${KITCHEN_ITEM_COLUMNS}
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      JOIN tables t ON t.id = o.table_id
      WHERE oi.status = 'pending' AND (
        o.status = 'open'
        OR (o.status = 'paid' AND t.table_type = 'immediate'
            AND o.closed_at >= now() - interval '12 hours')
      )
      ORDER BY oi.created_at ASC, oi.id ASC
    `);

    res.json(rows.map(mapKitchenRow));
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
      SELECT ${KITCHEN_ITEM_COLUMNS}
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      JOIN tables t ON t.id = o.table_id
      WHERE ${baseWhere}
      ORDER BY oi.created_at DESC
    `, params);

    res.json(rows.map(mapKitchenRow));
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

// PATCH /api/kitchen/items/serve-all — 画面に出ている未提供アイテムを一括で提供完了にする。
// itemId を明示的に受け取るのは、押した瞬間に届いた新規注文まで厨房が見ないまま
// 完了扱いになるのを防ぐため(サーバ側で pending 全件を対象にしない)。
router.patch('/items/serve-all', async (req, res, next) => {
  try {
    const raw = req.body?.itemIds;
    if (!Array.isArray(raw) || raw.length === 0) {
      return res.status(400).json({ error: 'itemIds (non-empty array) is required' });
    }
    if (raw.length > 500) {
      return res.status(400).json({ error: 'itemIds must be 500 or fewer' });
    }
    const itemIds = raw.map(Number).filter(Number.isInteger);
    if (itemIds.length !== raw.length) {
      return res.status(400).json({ error: 'itemIds must be integers' });
    }

    // 1文のUPDATEで完結させる(部分適用が起きない)。既に served のものは条件から外れるだけ。
    const { rows } = await query(
      `UPDATE order_items SET status = 'served'
        WHERE id = ANY($1::int[]) AND status = 'pending'
        RETURNING id, order_id`,
      [itemIds]
    );

    const servedItemIds = rows.map((r) => r.id);
    const orderIds = [...new Set(rows.map((r) => r.order_id))];
    // 一括用の新イベント。単数の kitchen:item_served はペイロード形状を保つため据え置く。
    if (servedItemIds.length > 0) {
      broadcast('kitchen:items_served', { itemIds: servedItemIds, orderIds, count: servedItemIds.length });
    }
    res.json({ count: servedItemIds.length, itemIds: servedItemIds });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
