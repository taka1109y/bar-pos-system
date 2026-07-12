CREATE TABLE IF NOT EXISTS tables (
    id         SERIAL PRIMARY KEY,
    name       TEXT NOT NULL,
    table_type TEXT NOT NULL DEFAULT 'table',
    status     TEXT NOT NULL DEFAULT 'available'
);

-- 既存DBへの追加カラムマイグレーション
ALTER TABLE tables ADD COLUMN IF NOT EXISTS table_type TEXT NOT NULL DEFAULT 'table';

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
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method    TEXT          NOT NULL DEFAULT 'cash';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS guest_count       INTEGER       NOT NULL DEFAULT 1;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_amount   NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tax_rate          NUMERIC(5,4)  NOT NULL DEFAULT 0.10;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tax_amount        NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS late_night_rate   NUMERIC(5,4)  NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS late_night_amount NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS memo                TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gift_cert_amount    NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gift_cert_no_change BOOLEAN       NOT NULL DEFAULT FALSE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS charge_per_person   NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS charge_amount       NUMERIC(10,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS order_items (
    id           SERIAL PRIMARY KEY,
    order_id     INTEGER NOT NULL REFERENCES orders(id),
    menu_item_id INTEGER NOT NULL REFERENCES menu_items(id),
    quantity     INTEGER NOT NULL DEFAULT 1,
    unit_price   NUMERIC(10,2) NOT NULL,
    item_name    TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'pending',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 既存DBへの追加カラムマイグレーション
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

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

CREATE TABLE IF NOT EXISTS system_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO system_settings (key, value) VALUES ('tax_rate',          '0.10') ON CONFLICT DO NOTHING;
INSERT INTO system_settings (key, value) VALUES ('late_night_rate',   '0.10') ON CONFLICT DO NOTHING;
INSERT INTO system_settings (key, value) VALUES ('late_night_start',  '22')   ON CONFLICT DO NOTHING;
INSERT INTO system_settings (key, value) VALUES ('late_night_end',    '29')   ON CONFLICT DO NOTHING;

-- 株価暴落機能
ALTER TABLE categories   ADD COLUMN IF NOT EXISTS crash_pct     NUMERIC(5,2)  NOT NULL DEFAULT 0;
ALTER TABLE subcategories ADD COLUMN IF NOT EXISTS crash_pct    NUMERIC(5,2)  NOT NULL DEFAULT 0;
ALTER TABLE menu_items   ADD COLUMN IF NOT EXISTS crash_enabled  BOOLEAN       NOT NULL DEFAULT FALSE;
ALTER TABLE menu_items   ADD COLUMN IF NOT EXISTS is_crashed     BOOLEAN       NOT NULL DEFAULT FALSE;

-- 商品画像URL
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS image_url TEXT;

-- 消費税軽減税率対応
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS tax_category TEXT NOT NULL DEFAULT 'standard';
INSERT INTO system_settings (key, value) VALUES ('reduced_tax_rate',     '0.08')     ON CONFLICT DO NOTHING;
INSERT INTO system_settings (key, value) VALUES ('default_tax_category', 'standard') ON CONFLICT DO NOTHING;

-- 従業員専用商品
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS is_staff_only BOOLEAN NOT NULL DEFAULT FALSE;

-- 価格変更可（時価）: 注文時にスタッフが価格・商品名を上書きできる商品フラグ
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS price_editable BOOLEAN NOT NULL DEFAULT FALSE;

-- 従業員専用カテゴリ
ALTER TABLE categories ADD COLUMN IF NOT EXISTS is_staff_only BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_pricing_events_item_time ON pricing_events(menu_item_id, event_time);
CREATE INDEX IF NOT EXISTS idx_price_history_item_time  ON price_history(menu_item_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_order_items_order        ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_orders_table_status      ON orders(table_id, status);

-- 赤伝票・黒伝票対応
-- receipt_type: 'normal' | 'black_cancelled' | 'void' | 'red'
ALTER TABLE orders ADD COLUMN IF NOT EXISTS receipt_type      TEXT    NOT NULL DEFAULT 'normal';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS original_order_id INTEGER REFERENCES orders(id);
CREATE INDEX IF NOT EXISTS idx_orders_receipt_type      ON orders(receipt_type);
CREATE INDEX IF NOT EXISTS idx_orders_original_order_id ON orders(original_order_id);

DROP TABLE IF EXISTS register_sessions;

-- 原価管理（cost_priceはレシピから自動計算）
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS cost_price NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS recipe_notes TEXT;

-- 既存在庫テーブル削除（材料ベースに移行）
DROP TABLE IF EXISTS inventory_logs;
DROP TABLE IF EXISTS inventory;

-- 材料マスター（ウイスキー角、炭酸水など）
CREATE TABLE IF NOT EXISTS ingredients (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    purchase_unit TEXT NOT NULL DEFAULT '本',
    purchase_quantity NUMERIC(10,3) NOT NULL DEFAULT 1,
    quantity_unit TEXT NOT NULL DEFAULT 'ml',
    cost_per_purchase_unit NUMERIC(10,2) NOT NULL DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- レシピ（商品と材料の対応）
CREATE TABLE IF NOT EXISTS recipes (
    id SERIAL PRIMARY KEY,
    menu_item_id INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
    ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
    usage_quantity NUMERIC(10,3) NOT NULL,
    UNIQUE(menu_item_id, ingredient_id)
);

-- 材料在庫
CREATE TABLE IF NOT EXISTS ingredient_stock (
    id SERIAL PRIMARY KEY,
    ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
    quantity_current NUMERIC(10,3) NOT NULL DEFAULT 0,
    last_updated TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(ingredient_id)
);

-- 材料在庫異動ログ
CREATE TABLE IF NOT EXISTS ingredient_stock_logs (
    id SERIAL PRIMARY KEY,
    ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
    quantity_before NUMERIC(10,3),
    quantity_after NUMERIC(10,3),
    quantity_change NUMERIC(10,3) NOT NULL,
    reason TEXT NOT NULL,
    related_order_id INTEGER REFERENCES orders(id),
    note TEXT,
    log_date TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ingredient_stock_logs_ingredient ON ingredient_stock_logs(ingredient_id);
CREATE INDEX IF NOT EXISTS idx_ingredient_stock_logs_log_date ON ingredient_stock_logs(log_date);
CREATE INDEX IF NOT EXISTS idx_recipes_menu_item ON recipes(menu_item_id);
CREATE INDEX IF NOT EXISTS idx_recipes_ingredient ON recipes(ingredient_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_category ON menu_items(category_id);

-- 商品の並び順（カテゴリ／サブカテゴリ内でのドラッグ&ドロップ用）
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_menu_items_sort ON menu_items(category_id, subcategory_id, sort_order);

-- 注文時の質問（ソースの種類・割り方など）: question_textが未設定の商品は質問なし
ALTER TABLE menu_items  ADD COLUMN IF NOT EXISTS question_text TEXT;
ALTER TABLE menu_items  ADD COLUMN IF NOT EXISTS question_choices JSONB;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS selected_option TEXT;

-- question_choices を文字列配列からオブジェクト配列 {label, priceDelta} へ移行（選択肢ごとの追加料金対応）
-- 冪等: 既にオブジェクト配列（priceDelta設定済み）の行は jsonb_typeof が'object'になるためスキップされる
UPDATE menu_items
SET question_choices = (
  SELECT jsonb_agg(jsonb_build_object('label', elem, 'priceDelta', 0))
  FROM jsonb_array_elements_text(question_choices) AS elem
)
WHERE question_choices IS NOT NULL
  AND jsonb_typeof(question_choices) = 'array'
  AND jsonb_array_length(question_choices) > 0
  AND jsonb_typeof(question_choices -> 0) = 'string';

-- テーブルごとにオープン注文は1件のみ（二重オープン防止）
-- 注意: 既存データにテーブルごとの複数オープン注文があると本文の適用に失敗する
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_one_open_per_table ON orders(table_id) WHERE status = 'open';

-- アーカイブ機能（古い会計済みデータの削除）が外部キー制約で失敗しないよう、
-- 監査証跡テーブルからの参照は削除時にNULLへ（参照先の注文が消えても証跡行自体は残す）
ALTER TABLE ingredient_stock_logs DROP CONSTRAINT IF EXISTS ingredient_stock_logs_related_order_id_fkey;
ALTER TABLE ingredient_stock_logs ADD CONSTRAINT ingredient_stock_logs_related_order_id_fkey
  FOREIGN KEY (related_order_id) REFERENCES orders(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE ingredient_stock_logs VALIDATE CONSTRAINT ingredient_stock_logs_related_order_id_fkey;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_original_order_id_fkey;
ALTER TABLE orders ADD CONSTRAINT orders_original_order_id_fkey
  FOREIGN KEY (original_order_id) REFERENCES orders(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE orders VALIDATE CONSTRAINT orders_original_order_id_fkey;
