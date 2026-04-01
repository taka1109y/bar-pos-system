const express = require('express');
const router = express.Router();
const { pool, query } = require('../db/database');
const { broadcastToRoom, broadcast } = require('../services/socketService');
const { triggerTick } = require('../services/pricingEngine');

async function getOrderWithItems(orderId) {
  const { rows: orderRows } = await query('SELECT * FROM orders WHERE id = $1', [orderId]);
  const order = orderRows[0];
  if (!order) return null;

  const { rows: items } = await query(
    `SELECT oi.id, oi.order_id, oi.menu_item_id, oi.quantity,
       oi.unit_price::float, oi.item_name,
       m.name as menu_name
     FROM order_items oi
     JOIN menu_items m ON oi.menu_item_id = m.id
     WHERE oi.order_id = $1`,
    [orderId]
  );

  return { ...order, total_amount: parseFloat(order.total_amount), items };
}

async function recalcTotal(client, orderId) {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(quantity * unit_price), 0)::float AS total
     FROM order_items WHERE order_id = $1`,
    [orderId]
  );
  const total = rows[0].total;
  await client.query('UPDATE orders SET total_amount = $1 WHERE id = $2', [total, orderId]);
  return total;
}

// GET /api/orders/table/:tableId
router.get('/table/:tableId', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM orders WHERE table_id = $1 AND status = 'open' ORDER BY id DESC LIMIT 1`,
      [req.params.tableId]
    );
    if (!rows[0]) return res.json(null);

    const order = rows[0];
    const { rows: items } = await query(
      `SELECT oi.id, oi.order_id, oi.menu_item_id, oi.quantity,
         oi.unit_price::float, oi.item_name
       FROM order_items oi
       WHERE oi.order_id = $1`,
      [order.id]
    );

    res.json({ ...order, total_amount: parseFloat(order.total_amount), items });
  } catch (err) {
    next(err);
  }
});

// POST /api/orders — 新しい注文を開く
router.post('/', async (req, res, next) => {
  try {
    const { table_id } = req.body;
    if (!table_id) return res.status(400).json({ error: 'table_id is required' });

    const { rows: existing } = await query(
      `SELECT id FROM orders WHERE table_id = $1 AND status = 'open'`,
      [table_id]
    );
    if (existing[0]) {
      return res.status(409).json({ error: 'Table already has an open order', orderId: existing[0].id });
    }

    const { rows } = await query(
      'INSERT INTO orders (table_id) VALUES ($1) RETURNING *',
      [table_id]
    );
    await query(`UPDATE tables SET status = 'occupied' WHERE id = $1`, [table_id]);
    broadcast('table:status_changed', { tableId: Number(table_id), status: 'occupied' });

    const order = await getOrderWithItems(rows[0].id);
    res.status(201).json(order);
  } catch (err) {
    // FK違反 (table_id が存在しない) → 400
    if (err.code === '23503') {
      return res.status(400).json({ error: 'table_id does not exist' });
    }
    next(err);
  }
});

// POST /api/orders/:id/items — アイテム追加
router.post('/:id/items', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { menu_item_id, quantity = 1 } = req.body;
    if (!menu_item_id) return res.status(400).json({ error: 'menu_item_id is required' });

    const { rows: orderRows } = await client.query(
      `SELECT * FROM orders WHERE id = $1 AND status = 'open'`,
      [req.params.id]
    );
    const order = orderRows[0];
    if (!order) return res.status(404).json({ error: 'Order not found or already closed' });

    const { rows: menuRows } = await client.query(
      'SELECT * FROM menu_items WHERE id = $1 AND is_active = TRUE',
      [menu_item_id]
    );
    const menuItem = menuRows[0];
    if (!menuItem) return res.status(404).json({ error: 'Menu item not found' });

    await client.query('BEGIN');

    // 既存の注文明細を確認
    const { rows: existingItems } = await client.query(
      'SELECT * FROM order_items WHERE order_id = $1 AND menu_item_id = $2',
      [order.id, menu_item_id]
    );

    if (existingItems[0]) {
      await client.query(
        'UPDATE order_items SET quantity = quantity + $1 WHERE id = $2',
        [quantity, existingItems[0].id]
      );
    } else {
      await client.query(
        `INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price, item_name)
         VALUES ($1, $2, $3, $4, $5)`,
        [order.id, menu_item_id, quantity, parseFloat(menuItem.current_price), menuItem.name]
      );
    }

    await recalcTotal(client, order.id);

    // ドリンクのみpricingイベントを記録
    if (menuItem.is_drink) {
      await client.query(
        'INSERT INTO pricing_events (menu_item_id, quantity) VALUES ($1, $2)',
        [menu_item_id, quantity]
      );
    }

    await client.query('COMMIT');

    // ドリンク注文時は価格を即時反映
    if (menuItem.is_drink) {
      triggerTick();
    }

    const updated = await getOrderWithItems(order.id);
    broadcastToRoom(`table:${order.table_id}`, 'order:updated', {
      tableId: order.table_id,
      orderId: order.id,
      items: updated.items,
      total: updated.total_amount,
    });

    res.json(updated);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// PATCH /api/orders/:id/items/:itemId — 数量変更
router.patch('/:id/items/:itemId', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { quantity } = req.body;
    if (quantity == null || quantity < 0) {
      return res.status(400).json({ error: 'quantity >= 0 required' });
    }

    const { rows: orderRows } = await client.query(
      `SELECT * FROM orders WHERE id = $1 AND status = 'open'`,
      [req.params.id]
    );
    const order = orderRows[0];
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const { rows: itemRows } = await client.query(
      'SELECT * FROM order_items WHERE id = $1 AND order_id = $2',
      [req.params.itemId, order.id]
    );
    if (!itemRows[0]) return res.status(404).json({ error: 'Order item not found' });

    await client.query('BEGIN');
    if (quantity === 0) {
      await client.query('DELETE FROM order_items WHERE id = $1', [req.params.itemId]);
    } else {
      await client.query('UPDATE order_items SET quantity = $1 WHERE id = $2', [quantity, req.params.itemId]);
    }
    await recalcTotal(client, order.id);
    await client.query('COMMIT');

    const updated = await getOrderWithItems(order.id);
    broadcastToRoom(`table:${order.table_id}`, 'order:updated', {
      tableId: order.table_id,
      orderId: order.id,
      items: updated.items,
      total: updated.total_amount,
    });

    res.json(updated);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// DELETE /api/orders/:id/items/:itemId — アイテム削除
router.delete('/:id/items/:itemId', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { rows: orderRows } = await client.query(
      `SELECT * FROM orders WHERE id = $1 AND status = 'open'`,
      [req.params.id]
    );
    const order = orderRows[0];
    if (!order) return res.status(404).json({ error: 'Order not found' });

    await client.query('BEGIN');
    await client.query('DELETE FROM order_items WHERE id = $1 AND order_id = $2', [req.params.itemId, order.id]);
    await recalcTotal(client, order.id);
    await client.query('COMMIT');

    const updated = await getOrderWithItems(order.id);
    broadcastToRoom(`table:${order.table_id}`, 'order:updated', {
      tableId: order.table_id,
      orderId: order.id,
      items: updated.items,
      total: updated.total_amount,
    });

    res.json(updated);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;
