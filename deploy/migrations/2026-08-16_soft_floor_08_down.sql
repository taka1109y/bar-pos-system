-- soft_floor 0.8 rollback: バックアップ表から min/max/current を復元。
-- ※monthly_discount_cap は別マイグレーション管理(2026-08-16_discount_cap_6000)。ここでは触らない。
UPDATE menu_items m
SET min_price     = b.min_price,
    max_price     = b.max_price,
    current_price = b.current_price
FROM menu_items_softfloor_backup b
WHERE m.id = b.id;

DROP TABLE IF EXISTS menu_items_softfloor_backup;
