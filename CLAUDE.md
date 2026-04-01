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

**Entry point**: `index.js` — registers middleware, mounts 6 route modules, sets up Socket.io event handlers, then runs `initDB() → seed() → startPricingEngine()`.

**Route modules** (`server/routes/`):
- `tables.js` — CRUD; DELETE blocks if open orders exist (409)
- `menu.js` — CRUD with soft delete (`is_active=false`); always returns `::float` casts for numeric fields
- `orders.js` — Order lifecycle + item add/update/delete; every item mutation runs `recalcTotal()` in a transaction
- `payments.js` — Closes orders, resets table status to `available`
- `prices.js` — Returns `current_price` with `pct_change` vs `base_price`; price history
- `reports.js` — Daily/hourly aggregations from closed orders

**Key services**:
- `services/socketService.js` — Singleton wrapper around Socket.io (`setIo`/`broadcast`/`broadcastToRoom`). Routes import `{ broadcast, broadcastToRoom }` from here, not from `index.js`.
- `services/pricingEngine.js` — Ticks every 30s. Reads demand from `pricing_events` (past 5 min, threshold=5 units), steps price 8% up / 4% down toward target, clamps to `[min_price, max_price]`, rounds to nearest ¥25. Broadcasts `prices:updated` only when price actually changes.

**Database schema** (`db/schema.sql`): `tables → orders → order_items`; `menu_items → categories`; `pricing_events` (demand tracking, pruned after 10 min); `price_history` (last 60 records per item).

### Client (`client/src/`)

**Routing** (`App.jsx`):
- `/` → `POSPage` — staff-facing POS (table grid, menu, order panel, payment)
- `/board` → `BoardPage` — price display board with sparklines
- `/table/:tableId` → `TablePage` — customer-facing order screen

**Data layer**:
- `api.js` — Fetch wrapper, all calls go through `BASE = /api`
- `socket.js` — Single shared Socket.io client instance (auto-reconnect)
- `store/usePriceStore.js` — Zustand store; `initPrices()` on page load, `updatePrices()` on `prices:updated` socket event; tracks `direction` and `flash` for animations

**Real-time pattern**: Components register named socket handlers in `useEffect` and pass the same reference to `socket.off()` on cleanup. Never use `socket.off(event)` without a handler reference — it removes all listeners for that event.

**Data fetching**: TanStack Query v5 for all API calls. Real-time updates from socket use `queryClient.setQueryData()` directly (avoids HTTP re-fetch). Optimistic updates in `addItemMutation` with rollback on error.

### Key Data Flow

**Surge pricing loop**:
1. `POST /api/orders/:id/items` → inserts into `pricing_events`
2. PricingEngine tick (30s) → reads demand, updates `menu_items.current_price`, broadcasts `prices:updated`
3. Client `usePriceStore.updatePrices()` → UI re-renders with flash animation

**Table lifecycle**: `available` → (create order) → `occupied` → (payment) → `available`. Status changes broadcast as `table:status_changed`.

**Staff call bell**: TablePage emits `customer:call_staff` → server broadcasts `staff:called` to all clients.

## Important Constraints

- **Numeric types**: PostgreSQL `NUMERIC` columns return as strings in `pg`. Always use `::float` casts in SQL queries. Never rely on `RETURNING *` for numeric fields — re-fetch with explicit casts or cast inline.
- **Soft delete**: Menu items are never hard-deleted; use `is_active = FALSE`. Orders and order items can be hard-deleted.
- **Transactions**: Any mutation to `order_items` must call `recalcTotal(client, orderId)` within the same transaction using the pool client, not the module-level `query()`.
- **Socket rooms**: Table-specific events use room `table:${tableId}`. Subscribe via `client:subscribe_table` / `client:unsubscribe_table` events.
