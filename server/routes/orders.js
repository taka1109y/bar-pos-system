const express = require('express');
const router = express.Router();
const { pool, query } = require('../db/database');
const { broadcastToRoom, broadcast } = require('../services/socketService');
const { triggerTick } = require('../services/pricingEngine');
const { nowInTZ } = require('../utils/time');

async function getOrderWithItems(orderId) {
  const { rows: orderRows } = await query(
    `SELECT id, table_id, status, payment_method, opened_at, closed_at,
       total_amount::float, discount_amount::float, tax_rate::float, tax_amount::float,
       late_night_rate::float, late_night_amount::float,
       guest_count, charge_per_person::float, charge_amount::float,
       receipt_type, original_order_id
     FROM orders WHERE id = $1`,
    [orderId]
  );
  const order = orderRows[0];
  if (!order) return null;

  const { rows: items } = await query(
    `SELECT oi.id, oi.order_id, oi.menu_item_id, oi.quantity,
       oi.unit_price::float, oi.item_name, oi.status
     FROM order_items oi
     WHERE oi.order_id = $1`,
    [orderId]
  );

  return { ...order, items };
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

// GET /api/orders/open — 通常オープン注文のみ（赤伝票は除外）
router.get('/open', async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, table_id, total_amount::float, opened_at, guest_count,
              charge_per_person::float, charge_amount::float
       FROM orders
       WHERE status = 'open'
         AND (receipt_type = 'normal' OR receipt_type IS NULL)
       ORDER BY table_id`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/orders/table/:tableId
router.get('/table/:tableId', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM orders
       WHERE table_id = $1 AND status = 'open'
         AND (receipt_type = 'normal' OR receipt_type IS NULL)
       ORDER BY id DESC LIMIT 1`,
      [req.params.tableId]
    );
    if (!rows[0]) return res.json(null);

    const order = rows[0];
    const { rows: items } = await query(
      `SELECT oi.id, oi.order_id, oi.menu_item_id, oi.quantity,
         oi.unit_price::float, oi.item_name, oi.status
       FROM order_items oi
       WHERE oi.order_id = $1`,
      [order.id]
    );

    res.json({
      id: order.id, table_id: order.table_id, status: order.status,
      payment_method: order.payment_method, opened_at: order.opened_at, closed_at: order.closed_at,
      total_amount: parseFloat(order.total_amount),
      discount_amount: parseFloat(order.discount_amount),
      tax_rate: parseFloat(order.tax_rate), tax_amount: parseFloat(order.tax_amount),
      late_night_rate: parseFloat(order.late_night_rate), late_night_amount: parseFloat(order.late_night_amount),
      guest_count: order.guest_count,
      charge_per_person: parseFloat(order.charge_per_person),
      charge_amount: parseFloat(order.charge_amount),
      receipt_type: order.receipt_type,
      original_order_id: order.original_order_id,
      items,
    });
  } catch (err) {
    next(err);
  }
});

function resolveCharge(slots, guestCount) {
  const h = nowInTZ().getHours();
  const slot = slots.find((s) => {
    const { start, end } = s;
    if (start < 24 && end > 24) return h >= start || h < (end - 24);
    if (start >= 24)             return h >= (start - 24) && h < (end - 24);
    return h >= start && h < end;
  });
  const perPerson = slot ? (parseInt(slot.amount) || 0) : 0;
  return { charge_per_person: perPerson, charge_amount: perPerson * guestCount };
}

// POST /api/orders — 新しい注文を開く
router.post('/', async (req, res, next) => {
  try {
    const { table_id, guest_count = 1 } = req.body;
    if (!table_id) return res.status(400).json({ error: 'table_id is required' });

    const { rows: existing } = await query(
      `SELECT id FROM orders WHERE table_id = $1 AND status = 'open'`,
      [table_id]
    );
    if (existing[0]) {
      return res.status(409).json({ error: 'Table already has an open order', orderId: existing[0].id });
    }

    // チャージ設定を読み取り
    const { rows: csRows } = await query(
      `SELECT key, value FROM system_settings WHERE key IN ('charge_enabled', 'charge_time_slots')`
    );
    const cs = csRows.reduce((acc, r) => { acc[r.key] = r.value; return acc; }, {});
    const chargeEnabled = cs.charge_enabled !== 'false';
    const slots = (() => { try { return JSON.parse(cs.charge_time_slots ?? '[]'); } catch { return []; } })();
    const guestCountNum = Math.max(1, parseInt(guest_count) || 1);
    const { charge_per_person, charge_amount } = chargeEnabled
      ? resolveCharge(slots, guestCountNum)
      : { charge_per_person: 0, charge_amount: 0 };

    const { rows } = await query(
      `INSERT INTO orders (table_id, guest_count, charge_per_person, charge_amount)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [table_id, guestCountNum, charge_per_person, charge_amount]
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

    const currentPrice = parseFloat(menuItem.current_price);

    await client.query('BEGIN');

    // 同一商品・同一単価の行があれば数量を積む。価格が変わっていたら新しい行を追加する。
    const { rows: existingItems } = await client.query(
      `SELECT * FROM order_items
       WHERE order_id = $1 AND menu_item_id = $2 AND unit_price::float = $3`,
      [order.id, menu_item_id, currentPrice]
    );

    if (existingItems[0]) {
      await client.query(
        'UPDATE order_items SET quantity = quantity + $1 WHERE id = $2',
        [quantity, existingItems[0].id]
      );
    } else {
      // 価格が異なる場合（値上がり・値下がり後）は別行として記録
      await client.query(
        `INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price, item_name)
         VALUES ($1, $2, $3, $4, $5)`,
        [order.id, menu_item_id, quantity, currentPrice, menuItem.name]
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
      chargeAmount: updated.charge_amount,
      chargePerPerson: updated.charge_per_person,
      guestCount: updated.guest_count,
    });

    res.json(updated);
  } catch (err) {
    await client.query('ROLLBACK').catch((rbErr) => { console.error('[orders] ROLLBACK failed:', rbErr); });
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
      chargeAmount: updated.charge_amount,
      chargePerPerson: updated.charge_per_person,
      guestCount: updated.guest_count,
    });

    res.json(updated);
  } catch (err) {
    await client.query('ROLLBACK').catch((rbErr) => { console.error('[orders] ROLLBACK failed:', rbErr); });
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
      chargeAmount: updated.charge_amount,
      chargePerPerson: updated.charge_per_person,
      guestCount: updated.guest_count,
    });

    res.json(updated);
  } catch (err) {
    await client.query('ROLLBACK').catch((rbErr) => { console.error('[orders] ROLLBACK failed:', rbErr); });
    next(err);
  } finally {
    client.release();
  }
});

// GET /api/orders/:orderId — 単一オーダー取得（赤伝票会計モーダル用）
router.get('/:orderId', async (req, res, next) => {
  try {
    const order = await getOrderWithItems(req.params.orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json(order);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
