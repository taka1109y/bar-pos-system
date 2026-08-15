-- 計装フェーズ1 UP マイグレーション（可逆・DOWNは *_down.sql）
-- 内容: 価格変動ログ price_events / base変更履歴 base_price_history の追加、
--       需要ログ(pricing_events)の剪定停止（永続化）。
-- 冪等: IF NOT EXISTS / ON CONFLICT を使用。既存データ・既存テーブルは破壊しない。

BEGIN;

-- 1-1: 価格変動イベントの永続ログ（掲示価格スナップショットも兼ねる）
CREATE TABLE IF NOT EXISTS price_events (
    id           BIGSERIAL PRIMARY KEY,
    menu_item_id INTEGER NOT NULL REFERENCES menu_items(id),
    price_before NUMERIC(10,2),
    price_after  NUMERIC(10,2) NOT NULL,
    event_type   TEXT NOT NULL,
    trigger      TEXT,
    event_time   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_price_events_item_time ON price_events (menu_item_id, event_time);

-- 1-2: base_price 変更履歴
CREATE TABLE IF NOT EXISTS base_price_history (
    id           BIGSERIAL PRIMARY KEY,
    menu_item_id INTEGER NOT NULL REFERENCES menu_items(id),
    price_before NUMERIC(10,2),
    price_after  NUMERIC(10,2) NOT NULL,
    changed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    operator     TEXT
);
CREATE INDEX IF NOT EXISTS idx_base_price_history_item_time ON base_price_history (menu_item_id, changed_at);

-- 1-1: 需要ログ pricing_events の剪定停止（永続化）。
-- 永続化された設定値を 0(=剪定なし) にする。コード側の既定も 0 だが、
-- 本番DBに旧値(600)が保存されている場合に備えて明示的に上書きする。
INSERT INTO system_settings (key, value) VALUES ('pricing_prune_events_seconds', '0')
ON CONFLICT (key) DO UPDATE SET value = '0';

COMMIT;
