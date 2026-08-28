const express = require('express');
const router = express.Router();
const { pool } = require('../db/database');
const { broadcast } = require('../services/socketService');
const { parsePayParams, settleOrderTx } = require('../services/paymentCore');

// POST /api/payments/:orderId — 座席テーブル等の会計（計算・確定は paymentCore に共通化）
router.post('/:orderId', async (req, res, next) => {
  // 検証・正規化（BEGIN 前）
  let params;
  try {
    params = parsePayParams(req.body);
  } catch (e) {
    if (e && e.status) return res.status(e.status).json({ error: e.error });
    throw e;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let out;
    try {
      out = await settleOrderTx(client, req.params.orderId, params);
    } catch (e) {
      if (e && e.status) { await client.query('ROLLBACK'); return res.status(e.status).json({ error: e.error }); }
      throw e;
    }
    await client.query('COMMIT');

    if (out.tableFreed) {
      broadcast('table:status_changed', { tableId: out.tableId, status: 'available' });
    }
    res.json(out.result);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;
