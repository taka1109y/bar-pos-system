-- Phase6-7 up: order_items に base_price_at_order を追加(可逆)。
-- 今後の注文は約定時点の menu_items.base_price をスナップ保存。
-- 集計は COALESCE(base_price_at_order, 現行 base_price) を使用(列追加以前は現行base参照の近似)。
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS base_price_at_order NUMERIC(10,2);
COMMENT ON COLUMN order_items.base_price_at_order IS 'Phase6-7: 約定時点の base_price スナップ(値引き費用集計用)。列追加以前はNULL';

-- 月次値引き費用上限(円)。0=無効。値引き費用(暴落原資)の月次アラート閾値。
INSERT INTO system_settings (key, value) VALUES ('monthly_discount_cap', '0')
ON CONFLICT (key) DO NOTHING;
