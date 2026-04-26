const express = require('express');
const router = express.Router();
const { pool } = require('../db/database');

// POST /api/maintenance/archive
// Body: { before_days: 90 }
// 指定日数以前の会計済みデータ（order_items + orders）を削除する
router.post('/archive', async (req, res, next) => {
  const beforeDays = Math.max(1, parseInt(req.body.before_days, 10) || 90);
  const client = await pool.connect();
  try {
    // 削除対象の件数を先に確認
    const { rows: preview } = await client.query(
      `SELECT COUNT(*)::int AS order_count
       FROM orders
       WHERE status = 'paid'
         AND closed_at < NOW() - ($1 || ' days')::INTERVAL`,
      [beforeDays]
    );
    const orderCount = preview[0].order_count;

    if (orderCount === 0) {
      return res.json({ deleted_orders: 0, deleted_items: 0, before_days: beforeDays });
    }

    await client.query('BEGIN');

    const { rowCount: deletedItems } = await client.query(
      `DELETE FROM order_items
       WHERE order_id IN (
         SELECT id FROM orders
         WHERE status = 'paid'
           AND closed_at < NOW() - ($1 || ' days')::INTERVAL
       )`,
      [beforeDays]
    );

    const { rowCount: deletedOrders } = await client.query(
      `DELETE FROM orders
       WHERE status = 'paid'
         AND closed_at < NOW() - ($1 || ' days')::INTERVAL`,
      [beforeDays]
    );

    await client.query('COMMIT');

    res.json({
      deleted_orders: deletedOrders,
      deleted_items:  deletedItems,
      before_days:    beforeDays,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch((rbErr) => {
      console.error('[maintenance] ROLLBACK failed:', rbErr);
    });
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;
