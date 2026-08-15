-- Phase6-1b down: 非表示化したピーチサワー(レシピ無し)を再有効化。
UPDATE menu_items SET is_active = TRUE
WHERE name = 'ピーチサワー'
  AND is_active = FALSE
  AND id NOT IN (SELECT DISTINCT menu_item_id FROM recipes);
