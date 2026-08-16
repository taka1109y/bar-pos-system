-- Hardening rollback: 冪等キー列と索引を削除。
DROP INDEX IF EXISTS uq_order_items_order_idem;
ALTER TABLE order_items DROP COLUMN IF EXISTS idempotency_key;
ALTER TABLE orders      DROP COLUMN IF EXISTS idempotency_key;
