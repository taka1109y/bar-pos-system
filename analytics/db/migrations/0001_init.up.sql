-- 0001_init: 分析DB(analyticsdb) 初期スキーマ
-- 可逆: 0001_init.down.sql が逆順に DROP する
-- すべて IF NOT EXISTS / ON CONFLICT DO NOTHING で再実行安全
-- schema_migrations は analytics/server/db/migrate.js が自前で作成するためここには含めない

-- 店舗設定（1行固定）
CREATE TABLE IF NOT EXISTS store_settings (
  id                         SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  business_day_boundary_hour SMALLINT NOT NULL DEFAULT 9 CHECK (business_day_boundary_hour BETWEEN 0 AND 12),
  fiscal_year_start_month    SMALLINT NOT NULL DEFAULT 1 CHECK (fiscal_year_start_month BETWEEN 1 AND 12),
  week_start_dow             SMALLINT NOT NULL DEFAULT 1 CHECK (week_start_dow BETWEEN 0 AND 6),
  default_day_mode           TEXT     NOT NULL DEFAULT 'business' CHECK (default_day_mode IN ('business', 'calendar')),
  abc_a_pct                  SMALLINT NOT NULL DEFAULT 70,
  abc_b_pct                  SMALLINT NOT NULL DEFAULT 90,
  include_owner_labor        BOOLEAN  NOT NULL DEFAULT TRUE,
  open_hour32                SMALLINT NOT NULL DEFAULT 17,
  close_hour32               SMALLINT NOT NULL DEFAULT 29,
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO store_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

-- 席数（稼働率計算用。table_id は bardb.tables.id と対応）
CREATE TABLE IF NOT EXISTS seat_capacities (
  table_id               INTEGER PRIMARY KEY,
  table_name             TEXT    NOT NULL,
  seats                  INTEGER NOT NULL DEFAULT 0 CHECK (seats >= 0),
  include_in_utilization BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 経費科目
CREATE TABLE IF NOT EXISTS expense_categories (
  id         SERIAL PRIMARY KEY,
  code       TEXT UNIQUE NOT NULL,
  name       TEXT NOT NULL,
  cost_type  TEXT CHECK (cost_type IN ('fixed', 'variable')),
  pnl_line   TEXT CHECK (pnl_line IN ('purchase', 'labor', 'rent', 'utilities', 'supplies', 'marketing', 'fees', 'other')),
  sort_order INT DEFAULT 0,
  is_active  BOOLEAN DEFAULT TRUE
);
INSERT INTO expense_categories (code, name, cost_type, pnl_line, sort_order) VALUES
  ('rent',        '家賃',             'fixed',    'rent',      1),
  ('utility',     '光熱費',           'variable', 'utilities', 2),
  ('purchase',    '仕入れ',           'variable', 'purchase',  3),
  ('supplies',    '消耗品',           'variable', 'supplies',  4),
  ('labor_other', '人件費(シフト外)', 'variable', 'labor',     5),
  ('marketing',   '販促',             'variable', 'marketing', 6),
  ('fees',        '決済手数料',       'variable', 'fees',      7),
  ('other',       'その他',           'variable', 'other',     9)
ON CONFLICT (code) DO NOTHING;

-- 経費
CREATE TABLE IF NOT EXISTS expenses (
  id            SERIAL PRIMARY KEY,
  expense_date  DATE NOT NULL,
  category_id   INT  NOT NULL REFERENCES expense_categories(id),
  amount        INTEGER NOT NULL CHECK (amount >= 0),
  tax_included  BOOLEAN DEFAULT TRUE,
  alloc_method  TEXT DEFAULT 'date' CHECK (alloc_method IN ('date', 'month_even')),
  vendor        TEXT,
  memo          TEXT,
  recurrence_id INT,
  period_month  DATE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS expenses_recurrence_period_uq
  ON expenses (recurrence_id, period_month) WHERE recurrence_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS expenses_expense_date_idx ON expenses (expense_date);

-- 定期経費（毎月自動計上の元データ）
CREATE TABLE IF NOT EXISTS recurring_expenses (
  id           SERIAL PRIMARY KEY,
  category_id  INT NOT NULL REFERENCES expense_categories(id),
  amount       INTEGER NOT NULL CHECK (amount >= 0),
  day_of_month SMALLINT DEFAULT 1 CHECK (day_of_month BETWEEN 1 AND 28),
  alloc_method TEXT DEFAULT 'month_even' CHECK (alloc_method IN ('date', 'month_even')),
  vendor       TEXT,
  memo         TEXT,
  is_active    BOOLEAN DEFAULT TRUE
);

-- スタッフ
CREATE TABLE IF NOT EXISTS staff (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  employment_type TEXT NOT NULL DEFAULT 'hourly' CHECK (employment_type IN ('hourly', 'monthly', 'owner')),
  hourly_wage     INTEGER NOT NULL DEFAULT 0 CHECK (hourly_wage >= 0),
  monthly_salary  INTEGER NOT NULL DEFAULT 0 CHECK (monthly_salary >= 0),
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 時給履歴
CREATE TABLE IF NOT EXISTS staff_wage_history (
  id             SERIAL PRIMARY KEY,
  staff_id       INT  NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  effective_from DATE NOT NULL,
  hourly_wage    INTEGER NOT NULL,
  UNIQUE (staff_id, effective_from)
);

-- シフト（人件費計算用）
CREATE TABLE IF NOT EXISTS shifts (
  id                   SERIAL PRIMARY KEY,
  staff_id             INT  NOT NULL REFERENCES staff(id),
  business_date        DATE NOT NULL,
  start_at             TIMESTAMPTZ NOT NULL,
  end_at               TIMESTAMPTZ NOT NULL,
  break_minutes        INT DEFAULT 0 CHECK (break_minutes >= 0),
  hourly_wage_snapshot INTEGER NOT NULL CHECK (hourly_wage_snapshot >= 0),
  memo                 TEXT,
  CHECK (end_at > start_at),
  UNIQUE (staff_id, start_at)
);
CREATE INDEX IF NOT EXISTS shifts_business_date_idx ON shifts (business_date);

-- 目標
CREATE TABLE IF NOT EXISTS targets (
  id           SERIAL PRIMARY KEY,
  period_type  TEXT CHECK (period_type IN ('day', 'month', 'year')),
  period_start DATE NOT NULL,
  metric       TEXT CHECK (metric IN ('revenue', 'gross_profit', 'operating_profit', 'guest_count', 'order_count')),
  value        NUMERIC(12,2) NOT NULL CHECK (value >= 0),
  memo         TEXT,
  UNIQUE (period_type, period_start, metric)
);

-- 営業日タグ（試合日・イベント等）
CREATE TABLE IF NOT EXISTS tags (
  id        SERIAL PRIMARY KEY,
  code      TEXT UNIQUE NOT NULL,
  name      TEXT NOT NULL,
  tag_group TEXT CHECK (tag_group IN ('event', 'match', 'holiday', 'campaign', 'weather', 'other')),
  color     TEXT DEFAULT 'neutral',
  is_active BOOLEAN DEFAULT TRUE
);
INSERT INTO tags (code, name, tag_group, color) VALUES
  ('match',    '試合日',     'match',    'info'),
  ('event',    'イベント',   'event',    'success'),
  ('holiday',  '祝日',       'holiday',  'warning'),
  ('campaign', '暴落ナイト', 'campaign', 'danger')
ON CONFLICT DO NOTHING;

-- 営業日メモ（天候・特記事項）
CREATE TABLE IF NOT EXISTS business_days (
  business_date DATE PRIMARY KEY,
  is_open       BOOLEAN DEFAULT TRUE,
  weather       TEXT CHECK (weather IN ('sunny', 'cloudy', 'rain', 'heavy_rain', 'snow')),
  temperature_c NUMERIC(4,1),
  note          TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS business_day_tags (
  business_date DATE REFERENCES business_days(business_date) ON DELETE CASCADE,
  tag_id        INT  REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (business_date, tag_id)
);

-- レジ精算記録（現金過不足）
CREATE TABLE IF NOT EXISTS register_closings (
  business_date DATE PRIMARY KEY,
  open_cash     INT DEFAULT 0,
  system_cash   INT DEFAULT 0,
  counted_cash  INT DEFAULT 0,
  cash_diff     INT GENERATED ALWAYS AS (counted_cash - system_cash) STORED,
  memo          TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 本番スナップショット取込記録
CREATE TABLE IF NOT EXISTS snapshot_imports (
  id                SERIAL PRIMARY KEY,
  imported_at       TIMESTAMPTZ DEFAULT NOW(),
  dump_file         TEXT,
  orders_count      INT,
  order_items_count INT,
  max_closed_at     TIMESTAMPTZ,
  parity_ok         BOOLEAN,
  parity_detail     JSONB
);

-- 整合性検証の実行履歴
CREATE TABLE IF NOT EXISTS verification_runs (
  id         SERIAL PRIMARY KEY,
  run_at     TIMESTAMPTZ DEFAULT NOW(),
  check_name TEXT NOT NULL,
  ok         BOOLEAN NOT NULL,
  detail     JSONB
);
CREATE INDEX IF NOT EXISTS verification_runs_run_at_idx ON verification_runs (run_at DESC);
