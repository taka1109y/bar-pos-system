const express = require('express');
const router = express.Router();
const { query } = require('../db/database');
const { broadcast } = require('../services/socketService');

// GET /api/tables
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM tables ORDER BY id');
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// POST /api/tables
router.post('/', async (req, res, next) => {
  try {
    const { name, capacity = 4 } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const { rows } = await query(
      'INSERT INTO tables (name, capacity) VALUES ($1, $2) RETURNING *',
      [name, capacity]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/tables/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const { name, capacity, status } = req.body;
    const { rows: existing } = await query('SELECT * FROM tables WHERE id = $1', [req.params.id]);
    if (!existing[0]) return res.status(404).json({ error: 'Table not found' });

    const updates = [];
    const values = [];
    let idx = 1;
    if (name !== undefined) { updates.push(`name = $${idx++}`); values.push(name); }
    if (capacity !== undefined) { updates.push(`capacity = $${idx++}`); values.push(capacity); }
    if (status !== undefined) { updates.push(`status = $${idx++}`); values.push(status); }

    if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

    values.push(req.params.id);
    const { rows } = await query(
      `UPDATE tables SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
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
    await query('DELETE FROM tables WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
