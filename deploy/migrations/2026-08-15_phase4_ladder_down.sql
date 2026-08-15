-- Phase4 DOWN: 退避表 menu_items_price_backup から min/max/step/current を復元してロールバック。
-- コード側(pricingEngine の期モデル・orders.js の stepUpOnOrder・menu.js の暴落変更)は git revert で戻す。
BEGIN;

UPDATE menu_items m SET
  min_price = b.min_price,
  max_price = b.max_price,
  price_step_up = b.price_step_up,
  price_step_down = b.price_step_down,
  current_price = b.current_price
FROM menu_items_price_backup b WHERE m.id = b.id;

DROP TABLE IF EXISTS menu_items_price_backup;
-- 期・暴落の一時キーも掃除（あれば）
DELETE FROM system_settings WHERE key IN ('period_ends_at');

COMMIT;
