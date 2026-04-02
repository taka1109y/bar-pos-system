CREATE TABLE IF NOT EXISTS tables (
    id       SERIAL PRIMARY KEY,
    name     TEXT NOT NULL,
    capacity INTEGER NOT NULL DEFAULT 4,
    status   TEXT NOT NULL DEFAULT 'available'
);

CREATE TABLE IF NOT EXISTS categories (
    id         SERIAL PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS subcategories (
    id          SERIAL PRIMARY KEY,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS menu_items (
    id             SERIAL PRIMARY KEY,
    category_id    INTEGER NOT NULL REFERENCES categories(id),
    subcategory_id INTEGER REFERENCES subcategories(id) ON DELETE SET NULL,
    name           TEXT NOT NULL,
    base_price     NUMERIC(10,2) NOT NULL,
    current_price  NUMERIC(10,2) NOT NULL,
    min_price      NUMERIC(10,2) NOT NULL,
    max_price      NUMERIC(10,2) NOT NULL,
    price_step_up   NUMERIC(10,2) NOT NULL DEFAULT 50,
    price_step_down NUMERIC(10,2) NOT NULL DEFAULT 25,
    is_drink       BOOLEAN NOT NULL DEFAULT TRUE,
    is_active      BOOLEAN NOT NULL DEFAULT TRUE
);

-- 既存DBへの追加カラムマイグレーション
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS subcategory_id  INTEGER        REFERENCES subcategories(id) ON DELETE SET NULL;
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS price_step_up   NUMERIC(10,2)  NOT NULL DEFAULT 50;
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS price_step_down NUMERIC(10,2)  NOT NULL DEFAULT 25;

CREATE TABLE IF NOT EXISTS orders (
    id             SERIAL PRIMARY KEY,
    table_id       INTEGER NOT NULL REFERENCES tables(id),
    status         TEXT NOT NULL DEFAULT 'open',
    total_amount   NUMERIC(10,2) NOT NULL DEFAULT 0,
    payment_method TEXT NOT NULL DEFAULT 'cash',
    opened_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at      TIMESTAMPTZ
);

-- 既存DBへの追加カラムマイグレーション
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'cash';

CREATE TABLE IF NOT EXISTS order_items (
    id           SERIAL PRIMARY KEY,
    order_id     INTEGER NOT NULL REFERENCES orders(id),
    menu_item_id INTEGER NOT NULL REFERENCES menu_items(id),
    quantity     INTEGER NOT NULL DEFAULT 1,
    unit_price   NUMERIC(10,2) NOT NULL,
    item_name    TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'pending'
);

-- 既存DBへの追加カラムマイグレーション
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';

CREATE TABLE IF NOT EXISTS pricing_events (
    id           SERIAL PRIMARY KEY,
    menu_item_id INTEGER NOT NULL REFERENCES menu_items(id),
    quantity     INTEGER NOT NULL,
    event_time   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS price_history (
    id           SERIAL PRIMARY KEY,
    menu_item_id INTEGER NOT NULL REFERENCES menu_items(id),
    price        NUMERIC(10,2) NOT NULL,
    recorded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pricing_events_item_time ON pricing_events(menu_item_id, event_time);
CREATE INDEX IF NOT EXISTS idx_price_history_item_time  ON price_history(menu_item_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_order_items_order        ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_orders_table_status      ON orders(table_id, status);
