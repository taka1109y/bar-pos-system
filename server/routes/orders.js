const express = require('express');
const router = express.Router();
const { pool, query } = require('../db/database');
const { broadcastToRoom, broadcast } = require('../services/socketService');
const { triggerTick } = require('../services/pricingEngine');
const { nowInTZ, isHourInRange } = require('../utils/time');
const { clampInt } = require('../utils/validate');
const logger = require('../utils/logger');

// 1テーブルあたりの人数上限。charge_amount = 単価 × 人数 が
// orders.charge_amount の NUMERIC(10,2) を溢れて500になるのを防ぐ
const MAX_GUEST_COUNT = 99;

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
       oi.unit_price::float, oi.item_name, oi.status, oi.selected_option
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
      `SELECT id, table_id, status, payment_method, opened_at, closed_at,
              total_amount::float, discount_amount::float,
              tax_rate::float, tax_amount::float,
              late_night_rate::float, late_night_amount::float,
              guest_count, charge_per_person::float, charge_amount::float,
              receipt_type, original_order_id
       FROM orders
       WHERE table_id = $1 AND status = 'open'
         AND (receipt_type = 'normal' OR receipt_type IS NULL)
       ORDER BY id DESC LIMIT 1`,
      [req.params.tableId]
    );
    if (!rows[0]) return res.json(null);

    const order = rows[0];
    const { rows: items } = await query(
      `SELECT oi.id, oi.order_id, oi.menu_item_id, oi.quantity,
         oi.unit_price::float, oi.item_name, oi.status, oi.selected_option
       FROM order_items oi
       WHERE oi.order_id = $1`,
      [order.id]
    );

    res.json({ ...order, items });
  } catch (err) {
    next(err);
  }
});

async function loadChargeSettings() {
  const { rows } = await query(
    `SELECT key, value FROM system_settings WHERE key IN ('charge_enabled', 'charge_time_slots')`
  );
  const s = rows.reduce((acc, r) => { acc[r.key] = r.value; return acc; }, {});
  return {
    chargeEnabled: s.charge_enabled !== 'false',
    slots: (() => { try { return JSON.parse(s.charge_time_slots ?? '[]'); } catch { return []; } })(),
  };
}

function resolveCharge(slots, guestCount) {
  const h = nowInTZ().getHours();
  const slot = slots.find((s) => isHourInRange(h, s.start, s.end));
  const perPerson = slot ? (parseInt(slot.amount) || 0) : 0;
  return { charge_per_person: perPerson, charge_amount: perPerson * guestCount };
}

// POST /api/orders — 新しい注文を開く
router.post('/', async (req, res, next) => {
  try {
    const { table_id, guest_count = 1 } = req.body;
    if (!table_id) return res.status(400).json({ error: 'table_id is required' });

    // 赤伝票は席を使わない会計書類なので卓の占有判定から除外する
    // （idx_orders_one_open_per_table と GET /open も同条件）
    const { rows: existing } = await query(
      `SELECT id FROM orders
       WHERE table_id = $1 AND status = 'open'
         AND (receipt_type = 'normal' OR receipt_type IS NULL)`,
      [table_id]
    );
    if (existing[0]) {
      return res.status(409).json({ error: 'Table already has an open order', orderId: existing[0].id });
    }

    // 即会計テーブルかどうか確認（即会計はチャージ不要）
    const { rows: tableRows } = await query(
      `SELECT table_type FROM tables WHERE id = $1`, [table_id]
    );
    const isImmediate = tableRows[0]?.table_type === 'immediate';

    // チャージ設定を読み取り
    const { chargeEnabled, slots } = await loadChargeSettings();
    const guestCountNum = Math.max(1, parseInt(guest_count) || 1);
    const { charge_per_person, charge_amount } = (!isImmediate && chargeEnabled)
      ? resolveCharge(slots, guestCountNum)
      : { charge_per_person: 0, charge_amount: 0 };

    const { rows } = await query(
      `INSERT INTO orders (table_id, guest_count, charge_per_person, charge_amount)
       VALUES ($1, $2, $3, $4) RETURNING id`,
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
    // 二重オープン競合 (idx_orders_one_open_per_table) → 409
    if (err.code === '23505') {
      const { rows: existing } = await query(
        `SELECT id FROM orders
         WHERE table_id = $1 AND status = 'open'
           AND (receipt_type = 'normal' OR receipt_type IS NULL)`,
        [req.body.table_id]
      );
      return res.status(409).json({ error: 'Table already has an open order', orderId: existing[0]?.id });
    }
    next(err);
  }
});

// POST /api/orders/:id/items — アイテム追加
router.post('/:id/items', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { menu_item_id, quantity = 1, unit_price, item_name, selected_option } = req.body;
    if (!menu_item_id) return res.status(400).json({ error: 'menu_item_id is required' });
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty < 1) {
      return res.status(400).json({ error: 'quantity must be a positive integer' });
    }

    await client.query('BEGIN');

    // FOR UPDATE で行ロックを取得してから status 確認（会計処理との競合防止）
    const { rows: orderRows } = await client.query(
      `SELECT id, table_id FROM orders WHERE id = $1 AND status = 'open' FOR UPDATE`,
      [req.params.id]
    );
    const order = orderRows[0];
    if (!order) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Order not found or already closed' });
    }

    const { rows: menuRows } = await client.query(
      'SELECT id, name, current_price::float, is_drink, price_editable, question_text, question_choices FROM menu_items WHERE id = $1 AND is_active = TRUE',
      [menu_item_id]
    );
    const menuItem = menuRows[0];
    if (!menuItem) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Menu item not found' });
    }

    // 既定はメニュー登録値。price_editable(時価)商品のみ、スタッフ指定の価格・商品名で上書きする
    let finalPrice = parseFloat(menuItem.current_price);
    let finalName  = menuItem.name;
    if (menuItem.price_editable) {
      if (unit_price !== undefined && unit_price !== null && unit_price !== '') {
        const p = Number(unit_price);
        if (!Number.isFinite(p) || p < 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'unit_price must be a non-negative number' });
        }
        finalPrice = Math.round(p);
      }
      if (typeof item_name === 'string' && item_name.trim().length > 0) {
        if (item_name.trim().length > 100) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'item_name must be 1-100 characters' });
        }
        finalName = item_name.trim();
      }
    }

    // 質問が設定された商品は、選択肢の中から回答必須。選択肢ごとの追加料金(priceDelta)があれば単価に加算する
    let finalSelectedOption = null;
    if (menuItem.question_text) {
      if (typeof selected_option !== 'string' || selected_option.trim().length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: '回答を選択してください' });
      }
      const trimmed = selected_option.trim();
      const matchedChoice = (menuItem.question_choices || []).find((c) => c.label === trimmed);
      if (!matchedChoice) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: '無効な選択肢です' });
      }
      finalSelectedOption = trimmed;
      finalPrice += Number(matchedChoice.priceDelta) || 0;
    }

    // 注文アクションごとに必ず新しい行を追加する（マージしない）
    await client.query(
      `INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price, item_name, selected_option)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [order.id, menu_item_id, qty, finalPrice, finalName, finalSelectedOption]
    );

    await recalcTotal(client, order.id);

    // ドリンクのみpricingイベントを記録
    if (menuItem.is_drink) {
      await client.query(
        'INSERT INTO pricing_events (menu_item_id, quantity) VALUES ($1, $2)',
        [menu_item_id, qty]
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
    broadcast('orders:changed', { tableId: order.table_id });
    broadcast('kitchen:new_item', { orderId: order.id, tableId: order.table_id });

    res.json(updated);
  } catch (err) {
    await client.query('ROLLBACK').catch((rbErr) => { logger.warn({ err: rbErr }, 'orders ROLLBACK failed'); });
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
    const qty = Number(quantity);
    if (quantity == null || !Number.isInteger(qty) || qty < 0) {
      return res.status(400).json({ error: 'quantity must be an integer >= 0' });
    }

    await client.query('BEGIN');

    // FOR UPDATE で行ロックを取得してから status 確認（会計処理との競合防止）
    const { rows: orderRows } = await client.query(
      `SELECT id, table_id FROM orders WHERE id = $1 AND status = 'open' FOR UPDATE`,
      [req.params.id]
    );
    const order = orderRows[0];
    if (!order) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Order not found' });
    }

    const { rows: itemRows } = await client.query(
      'SELECT id FROM order_items WHERE id = $1 AND order_id = $2',
      [req.params.itemId, order.id]
    );
    if (!itemRows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Order item not found' });
    }

    if (qty === 0) {
      await client.query('DELETE FROM order_items WHERE id = $1', [req.params.itemId]);
    } else {
      await client.query('UPDATE order_items SET quantity = $1 WHERE id = $2', [qty, req.params.itemId]);
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
    broadcast('orders:changed', { tableId: order.table_id });

    res.json(updated);
  } catch (err) {
    await client.query('ROLLBACK').catch((rbErr) => { logger.warn({ err: rbErr }, 'orders ROLLBACK failed'); });
    next(err);
  } finally {
    client.release();
  }
});

// DELETE /api/orders/:id/items/:itemId — アイテム削除
router.delete('/:id/items/:itemId', async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // FOR UPDATE で行ロックを取得してから status 確認（会計処理との競合防止）
    const { rows: orderRows } = await client.query(
      `SELECT id, table_id FROM orders WHERE id = $1 AND status = 'open' FOR UPDATE`,
      [req.params.id]
    );
    const order = orderRows[0];
    if (!order) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Order not found' });
    }

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
    broadcast('orders:changed', { tableId: order.table_id });

    res.json(updated);
  } catch (err) {
    await client.query('ROLLBACK').catch((rbErr) => { logger.warn({ err: rbErr }, 'orders ROLLBACK failed'); });
    next(err);
  } finally {
    client.release();
  }
});

// PATCH /api/orders/:id/guest-count — 人数変更・チャージ再計算
router.patch('/:id/guest-count', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { guest_count } = req.body;
    const guestCountNum = clampInt(guest_count, 1, MAX_GUEST_COUNT, 1);

    await client.query('BEGIN');

    // FOR UPDATE で行ロックを取得してから status 確認（会計処理との競合防止）。
    // ロックを取らないと、会計処理が status='paid' にコミットした後に
    // 会計済みオーダーの人数・チャージを書き換えてしまう
    const { rows: orderRows } = await client.query(
      `SELECT o.id, o.table_id, o.charge_per_person, t.table_type
       FROM orders o JOIN tables t ON o.table_id = t.id
       WHERE o.id = $1 AND o.status = 'open' FOR UPDATE OF o`,
      [req.params.id]
    );
    const order = orderRows[0];
    if (!order) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Order not found or already closed' });
    }

    // 即会計テーブルかどうか確認（即会計はチャージ不要）
    const isImmediate = order.table_type === 'immediate';

    // 着席時に確定した単価(charge_per_person)を保持し、人数分だけ再計算する。
    // 時間帯スロットを現在時刻で再解決すると、時間帯境界（例 22:00 で ¥600→¥900）を
    // またいだ後の人数訂正で単価まで変わってしまうため、保存済みの単価をそのまま使う。
    const perPerson = isImmediate ? 0 : (parseFloat(order.charge_per_person) || 0);
    const charge_per_person = perPerson;
    const charge_amount = perPerson * guestCountNum;

    // status を再確認して、ロック待ちの間に会計されていた場合に上書きしない
    const { rowCount } = await client.query(
      `UPDATE orders SET guest_count = $1, charge_per_person = $2, charge_amount = $3
       WHERE id = $4 AND status = 'open'`,
      [guestCountNum, charge_per_person, charge_amount, order.id]
    );
    if (rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Order not found or already closed' });
    }

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
    broadcast('orders:changed', { tableId: order.table_id });

    res.json(updated);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// PATCH /api/orders/:id/table — テーブル移動（開いている注文を別の空きテーブルへ移す）
router.patch('/:id/table', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const newTableId = parseInt(req.body.table_id, 10);
    if (!Number.isInteger(newTableId)) {
      return res.status(400).json({ error: 'table_id is required' });
    }

    await client.query('BEGIN');

    // 対象注文を行ロックして status='open' を確認（会計処理との競合防止）
    const { rows: orderRows } = await client.query(
      `SELECT id, table_id FROM orders WHERE id = $1 AND status = 'open' FOR UPDATE`,
      [req.params.id]
    );
    const order = orderRows[0];
    if (!order) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Order not found or already closed' });
    }
    const oldTableId = order.table_id;
    if (oldTableId === newTableId) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Same table' });
    }

    // 移動先テーブルの存在・種別確認（即会計テーブルへは移動不可）
    const { rows: tableRows } = await client.query(
      `SELECT id, table_type FROM tables WHERE id = $1`,
      [newTableId]
    );
    const target = tableRows[0];
    if (!target) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Target table not found' });
    }
    if (target.table_type === 'immediate') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Cannot move to immediate table' });
    }

    // 移動先の空き確認（通常openが既にあれば移動不可）。部分ユニークIndexと同条件
    const { rows: occupied } = await client.query(
      `SELECT id FROM orders
       WHERE table_id = $1 AND status = 'open'
         AND (receipt_type = 'normal' OR receipt_type IS NULL)`,
      [newTableId]
    );
    if (occupied.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Target table already has an open order' });
    }

    // 移動（status を再確認し、ロック待ち中に会計された場合は上書きしない）
    const { rowCount } = await client.query(
      `UPDATE orders SET table_id = $1 WHERE id = $2 AND status = 'open'`,
      [newTableId, order.id]
    );
    if (rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Order not found or already closed' });
    }

    // テーブル状態: 新席を occupied、旧席は残 open が無ければ available に戻す
    await client.query(`UPDATE tables SET status = 'occupied' WHERE id = $1`, [newTableId]);
    const { rows: remaining } = await client.query(
      `SELECT id FROM orders WHERE table_id = $1 AND status = 'open'`,
      [oldTableId]
    );
    if (remaining.length === 0) {
      await client.query(`UPDATE tables SET status = 'available' WHERE id = $1`, [oldTableId]);
    }

    await client.query('COMMIT');

    const updated = await getOrderWithItems(order.id);
    // 旧席→available / 新席→occupied を全体へ通知
    broadcast('table:status_changed', { tableId: oldTableId, status: 'available' });
    broadcast('table:status_changed', { tableId: newTableId, status: 'occupied' });
    // 新席 room に注文本体を届ける（顧客タブレットが移動後の注文を自動表示する）
    broadcastToRoom(`table:${newTableId}`, 'order:updated', {
      tableId: newTableId,
      orderId: updated.id,
      items: updated.items,
      total: updated.total_amount,
      chargeAmount: updated.charge_amount,
      chargePerPerson: updated.charge_per_person,
      guestCount: updated.guest_count,
    });
    broadcast('orders:changed', { tableId: newTableId });

    res.json(updated);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') return res.status(409).json({ error: 'Target table already has an open order' });
    if (err.code === '23503') return res.status(400).json({ error: 'Target table not found' });
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
