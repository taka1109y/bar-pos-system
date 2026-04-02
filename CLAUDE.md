# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development (local, without Docker)
```bash
# Start everything concurrently (server + client dev server)
npm run dev

# Server only (port 3001, hot reload via nodemon)
cd server && npm run dev

# Client only (port 5173, Vite)
cd client && npm run dev
```

### Production (Docker)
```bash
# Full build and start
docker compose up -d --build

# Rebuild only the client (after frontend changes)
docker compose up -d --build --no-deps client

# Rebuild only the server (after backend changes)
docker compose up -d --build --no-deps server

# View logs
docker compose logs -f server
docker compose logs -f client
```

### Database
```bash
# Connect to running DB
docker compose exec postgres psql -U bar -d bardb

# Reset DB (drops and re-seeds on next server start)
docker compose exec postgres psql -U bar -d bardb -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
docker compose restart server
```

There are no automated tests. Testing is done manually with curl against `http://localhost` (Docker) or `http://localhost:3001` (local).

## Architecture

### Overview
3-container Docker stack: **PostgreSQL 16** → **Node.js/Express server** (port 3001) → **Nginx** (port 80, serves React SPA + proxies `/api/` and `/socket.io/`).

No ORM — raw SQL via `pg` pool. No authentication.

### Server (`server/`)

**Entry point**: `index.js` — registers middleware, mounts route modules, sets up Socket.io event handlers, then runs `initDB() → seed() → startPricingEngine()`.

**Route modules** (`server/routes/`):
- `tables.js` — CRUD; accepts `table_type` ('table'|'counter'); DELETE blocks if open orders exist (409)
- `menu.js` — CRUD with soft delete (`is_active=false`); always returns `::float` casts for numeric fields; supports subcategories
- `orders.js` — Order lifecycle + item add/update/delete; every item mutation runs `recalcTotal()` in a transaction; `GET /open` returns all open orders
- `payments.js` — Closes orders with tax + late-night surcharge calculation; resets table status to `available`
- `prices.js` — Returns `current_price` with `pct_change` vs `base_price`; price history
- `reports.js` — Daily/items aggregations from closed orders (hourly endpoint removed)
- `receipts.js` — `GET /api/receipts?date=YYYY-MM-DD`: paid orders with full item breakdown and fee details
- `system.js` — `GET/PATCH /api/system/settings`: tax_rate, late_night_rate, late_night_start, late_night_end
- `settings.js` — `GET/PATCH /api/settings/pricing`: runtime pricing engine parameters
- `kitchen.js` — Kitchen display: pending/in-progress order items; PATCH to update item status

**Key services**:
- `services/socketService.js` — Singleton wrapper around Socket.io (`setIo`/`broadcast`/`broadcastToRoom`). Routes import `{ broadcast, broadcastToRoom }` from here, not from `index.js`.
- `services/pricingEngine.js` — Ticks every 30s. Uses per-item `price_step_up`/`price_step_down` (¥ amounts). Subcategory competition logic: within the same subcategory, high-demand items rise while competitor demand pulls price down. Clamps to `[min_price, max_price]`, rounds to nearest ¥25. Broadcasts `prices:updated` only when price actually changes.
- `services/pricingSettings.js` — In-memory runtime config for pricing engine parameters (TICK_INTERVAL_MS, WINDOW_SECONDS, PRICE_STEP_DOWN, HISTORY_KEEP, PRUNE_EVENTS_SECONDS).

**Database schema** (`db/schema.sql`):
- `tables` — id, name, table_type ('table'|'counter'), capacity, status
- `categories` — id, name, sort_order
- `subcategories` — id, category_id, name, sort_order
- `menu_items` — id, category_id, subcategory_id, name, base_price, current_price, min_price, max_price, price_step_up, price_step_down, is_drink, is_active
- `orders` — id, table_id, status, total_amount, payment_method, opened_at, closed_at, discount_amount, tax_rate, tax_amount, late_night_rate, late_night_amount
- `order_items` — id, order_id, menu_item_id, quantity, unit_price, item_name, status
- `pricing_events` — demand tracking, pruned after 10 min
- `price_history` — last 60 records per item (sparkline data)
- `system_settings` — key-value table (tax_rate, late_night_rate, late_night_start, late_night_end)

### Client (`client/src/`)

**Routing** (`App.jsx`):
- `/` → `POSPage` — staff-facing POS (table grid, menu, order panel, payment)
- `/board` → `BoardPage` — price display board with sparklines
- `/table/:tableId` → `TablePage` — customer-facing order screen
- `/kitchen` → `KitchenPage` — kitchen display (order item status management)

**POSPage navigation** (sidebar):
- レジ画面 — table grid + order panel
- テーブル管理 — TableManager (add/edit/delete テーブル and カウンター)
- 商品管理 — MenuManager (menu item CRUD)
- カテゴリ管理 — CategoryManager
- 価格設定 — PricingPage (pricing engine parameters)
- 売上管理 — ReportsPage
- 伝票情報 — ReceiptsPage (paid receipt details by date)
- システム管理 — SystemSettingsPage (tax rate, late-night surcharge)
- 価格ボード ↗ — opens /board in new tab
- キッチン ↗ — opens /kitchen in new tab

**Data layer**:
- `api.js` — Fetch wrapper, all calls go through `BASE = /api`
- `socket.js` — Single shared Socket.io client instance (auto-reconnect)
- `store/usePriceStore.js` — Zustand store; `initPrices()` on page load, `updatePrices()` on `prices:updated` socket event; tracks `direction` and `flash` for animations

**Real-time pattern**: Components register named socket handlers in `useEffect` and pass the same reference to `socket.off()` on cleanup. Never use `socket.off(event)` without a handler reference — it removes all listeners for that event.

**Data fetching**: TanStack Query v5 for all API calls. Real-time updates from socket use `queryClient.setQueryData()` directly (avoids HTTP re-fetch). Optimistic updates in `addItemMutation` with rollback on error.

### Key Data Flow

**Surge pricing loop**:
1. `POST /api/orders/:id/items` → inserts into `pricing_events`
2. PricingEngine tick (30s) → reads demand per item and per subcategory, computes target price using `price_step_up`/`price_step_down`, updates `menu_items.current_price`, broadcasts `prices:updated`
3. Client `usePriceStore.updatePrices()` → UI re-renders with flash animation

**Payment calculation** (order of operations):
1. subtotal (税抜き)
2. + late_night_amount (深夜料金, if current time is within configured window)
3. − discount_amount
4. = taxable_base
5. + tax_amount (`taxable_base × tax_rate`)
6. = total

**Table lifecycle**: `available` → (create order) → `occupied` → (payment) → `available`. Status changes broadcast as `table:status_changed`.

**Table cards** (POSPage TableGrid): Occupied tables show total_amount (税込み) + elapsed time (hh:mm since first order). Empty tables render the same DOM block with `invisible` class to maintain equal card heights.

## Important Constraints

- **Numeric types**: PostgreSQL `NUMERIC` columns return as strings in `pg`. Always use `::float` casts in SQL queries. Never rely on `RETURNING *` for numeric fields — re-fetch with explicit casts or cast inline.
- **Soft delete**: Menu items are never hard-deleted; use `is_active = FALSE`. Orders and order items can be hard-deleted.
- **Transactions**: Any mutation to `order_items` must call `recalcTotal(client, orderId)` within the same transaction using the pool client, not the module-level `query()`.
- **Socket rooms**: Table-specific events use room `table:${tableId}`. Subscribe via `client:subscribe_table` / `client:unsubscribe_table` events.
- **Late-night time format**: 32-hour format (e.g., 29 = 5:00 AM next day). Server-side check uses JST via `toLocaleString('en-US', { timeZone: 'Asia/Tokyo' })`. Client-side check uses `new Date().getHours()` with same 32h math.
- **System settings**: Always read from `system_settings` table at payment time — never cache in application memory.
