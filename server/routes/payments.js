const express = require('express');
const router = express.Router();
const { pool } = require('../db/database');
const { broadcast } = require('../services/socketService');

const VALID_METHODS = ['cash', 'card', 'emoney'];

// POST /api/payments/:orderId
router.post('/:orderId', async (req, res, next) => {
  const { payment_method = 'cash' } = req.body;
  if (!VALID_METHODS.includes(payment_method)) {
    return res.status(400).json({ error: 'Invalid payment_method. Use cash, card, or emoney.' });
  }

  const client = await pool.connect();
  try {
    const { rows: orderRows } = await client.query(
      `SELECT * FROM orders WHERE id = $1 AND status = 'open'`,
      [req.params.orderId]
    );
    const order = orderRows[0];
    if (!order) return res.status(404).json({ error: 'Open order not found' });

    const { rows: items } = await client.query(
      `SELECT oi.*, m.name as menu_name
       FROM order_items oi
       JOIN menu_items m ON oi.menu_item_id = m.id
       WHERE oi.order_id = $1`,
      [order.id]
    );

    const total = items.reduce((sum, i) => sum + i.quantity * parseFloat(i.unit_price), 0);

    await client.query('BEGIN');
    await client.query(
      `UPDATE orders SET status = 'paid', closed_at = NOW(), total_amount = $1, payment_method = $2 WHERE id = $3`,
      [total, payment_method, order.id]
    );
    await client.query(`UPDATE tables SET status = 'available' WHERE id = $1`, [order.table_id]);
    await client.query('COMMIT');

    broadcast('table:status_changed', { tableId: order.table_id, status: 'available' });

    res.json({
      orderId: order.id,
      tableId: order.table_id,
      items,
      total,
      paymentMethod: payment_method,
      paidAt: new Date().toISOString(),
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;
