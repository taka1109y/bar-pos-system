-- Hardening: 冪等キーで二重会計/二重明細を防止(可逆)。
-- クライアントが操作ごとに生成する UUID を保存し、タイムアウト自動リトライでも重複処理しない。
ALTER TABLE orders      ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

-- 明細追加の重複を DB レベルで排除(同一オーダー内でキー一意)。NULL(旧データ/未指定)は対象外。
CREATE UNIQUE INDEX IF NOT EXISTS uq_order_items_order_idem
  ON order_items (order_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN orders.idempotency_key      IS 'Hardening: 会計操作の冪等キー(タイムアウト再送の重複会計防止)';
COMMENT ON COLUMN order_items.idempotency_key IS 'Hardening: 明細追加の冪等キー(再送の重複明細防止)';
