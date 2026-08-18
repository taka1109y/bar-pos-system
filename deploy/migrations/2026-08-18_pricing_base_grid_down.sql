-- 2026-08-18 down: Phase7 移行を撤回。stored min/max/current を backup から復元し backup 表を削除。
-- ※コード側も Phase7 前(main の Phase6 格子)へ戻すこと(code と stored の同時性)。
UPDATE menu_items m
SET min_price = b.min_price, max_price = b.max_price, current_price = b.current_price
FROM menu_items_pbgrid_backup b
WHERE m.id = b.id;

DROP TABLE IF EXISTS menu_items_pbgrid_backup;
