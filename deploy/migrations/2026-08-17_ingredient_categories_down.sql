-- 2026-08-17 down: 材料カテゴリを撤去。
-- 先に ingredients.category_id を落として FK 依存を解消してから ingredient_categories を削除する。
-- INDEX は列削除に伴い自動で消えるが、明示的にも DROP INDEX IF EXISTS しておく。
DROP INDEX IF EXISTS idx_ingredients_category;
ALTER TABLE ingredients DROP COLUMN IF EXISTS category_id;
DROP TABLE IF EXISTS ingredient_categories;
