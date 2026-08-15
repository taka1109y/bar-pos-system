-- Phase6-1b up: ピーチサワー重複の整理。レシピ有りの行を残し、レシピ無しの重複行を非表示化。
-- DELETE禁止(注文履歴の参照を保持するため is_active=false のみ)。
-- ガード: ピーチサワーが2件以上 かつ レシピ有り版が存在する場合のみ実行(誤爆防止)。
UPDATE menu_items SET is_active = FALSE
WHERE name = 'ピーチサワー'
  AND is_active = TRUE
  AND id NOT IN (SELECT DISTINCT menu_item_id FROM recipes)
  AND EXISTS (
    SELECT 1 FROM menu_items m2 JOIN recipes r ON r.menu_item_id = m2.id
    WHERE m2.name = 'ピーチサワー' AND m2.is_active = TRUE
  )
  AND (SELECT COUNT(*) FROM menu_items WHERE name = 'ピーチサワー' AND is_active = TRUE) >= 2;
