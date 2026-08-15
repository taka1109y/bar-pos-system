-- Phase6-1 down: バックアップ表から min/max/current/step を復元。
UPDATE menu_items m
SET min_price       = b.min_price,
    max_price       = b.max_price,
    current_price   = b.current_price,
    price_step_up   = b.price_step_up,
    price_step_down = b.price_step_down
FROM menu_items_price_backup_p6 b
WHERE m.id = b.id;

DROP TABLE IF EXISTS menu_items_price_backup_p6;
