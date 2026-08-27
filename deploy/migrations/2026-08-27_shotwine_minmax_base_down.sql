-- 2026-08-27 down: ショット＆ワインの min/max を揃える前の値へ復元し、backup 表を破棄。
-- backup 表(menu_items_shotwine_minmax_backup)が存在する適用直後のみ有効(各1回)。
UPDATE menu_items m
  SET min_price = b.min_price, max_price = b.max_price
  FROM menu_items_shotwine_minmax_backup b
  WHERE m.id = b.id;

DROP TABLE IF EXISTS menu_items_shotwine_minmax_backup;
