const express = require('express');
const router = express.Router();
const { query } = require('../db/database');
const { broadcast } = require('../services/socketService');

const VALID_TYPES = ['table', 'counter'];

// GET /api/tables
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT id, name, table_type, status FROM tables WHERE table_type != 'immediate' ORDER BY id`);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/tables/immediate — 即会計専用テーブルを返す（/:id の前に配置）
router.get('/immediate', async (_req, res, next) => {
  try {
    const { rows } = await query(`SELECT id, name, table_type, status FROM tables WHERE table_type = 'immediate' LIMIT 1`);
    if (!rows[0]) return res.status(404).json({ error: 'Immediate table not found' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// POST /api/tables
router.post('/', async (req, res, next) => {
  try {
    const { name, table_type = 'table' } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (name.length > 100) {
      return res.status(400).json({ error: 'name must be 100 characters or fewer' });
    }
    if (!VALID_TYPES.includes(table_type)) {
      return res.status(400).json({ error: 'table_type must be table or counter' });
    }
    const { rows } = await query(
      'INSERT INTO tables (name, table_type) VALUES ($1, $2) RETURNING id, name, table_type, status',
      [name.trim(), table_type]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/tables/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const { name, table_type, status } = req.body;
    const { rows: existing } = await query('SELECT id FROM tables WHERE id = $1', [req.params.id]);
    if (!existing[0]) return res.status(404).json({ error: 'Table not found' });

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ error: 'name must not be empty' });
      }
      if (name.length > 100) {
        return res.status(400).json({ error: 'name must be 100 characters or fewer' });
      }
    }
    if (table_type !== undefined && !VALID_TYPES.includes(table_type)) {
      return res.status(400).json({ error: 'table_type must be table or counter' });
    }

    const updates = [];
    const values = [];
    let idx = 1;
    if (name !== undefined)       { updates.push(`name = $${idx++}`);       values.push(name.trim()); }
    if (table_type !== undefined) { updates.push(`table_type = $${idx++}`); values.push(table_type); }
    if (status !== undefined)     { updates.push(`status = $${idx++}`);     values.push(status); }

    if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

    values.push(req.params.id);
    const { rows } = await query(
      `UPDATE tables SET ${updates.join(', ')} WHERE id = $${idx} RETURNING id, name, table_type, status`,
      values
    );

    if (status !== undefined) {
      broadcast('table:status_changed', { tableId: rows[0].id, status: rows[0].status });
    }

    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/tables/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT id FROM tables WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Table not found' });

    const { rows: openOrders } = await query(
      `SELECT id FROM orders WHERE table_id = $1 AND status = 'open'`,
      [req.params.id]
    );
    if (openOrders.length > 0) {
      return res.status(409).json({ error: 'Cannot delete table with open orders' });
    }

    const { rows: allOrders } = await query(
      'SELECT id FROM orders WHERE table_id = $1 LIMIT 1',
      [req.params.id]
    );
    if (allOrders.length > 0) {
      return res.status(409).json({ error: 'Cannot delete table with order history' });
    }

    await query('DELETE FROM tables WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
