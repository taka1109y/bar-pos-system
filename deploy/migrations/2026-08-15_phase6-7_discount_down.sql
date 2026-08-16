-- Phase6-7 down: 追加列と設定キーを削除。
ALTER TABLE order_items DROP COLUMN IF EXISTS base_price_at_order;
DELETE FROM system_settings WHERE key = 'monthly_discount_cap';
