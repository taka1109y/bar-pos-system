-- 2026-08-17 up: 材料カテゴリ(ingredient_categories)を新設し、ingredients に category_id を追加。
-- 目的: レシピ作成時の材料検索・絞り込みを可能にする(材料マスターに分類軸が無かった)。
-- 冪等(CREATE TABLE / ADD COLUMN IF NOT EXISTS, INSERT ... ON CONFLICT DO NOTHING)。
-- category_id は純粋なラベル列。原価計算・在庫減算・FK(recipes/ingredient_stock)には一切影響しない。
-- ON DELETE SET NULL: カテゴリ削除時に材料は未分類へ(データは失われない)。

CREATE TABLE IF NOT EXISTS ingredient_categories (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES ingredient_categories(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_ingredients_category ON ingredients(category_id);

-- 初期カテゴリ7分類(オーナー承認)。既存があればスキップ。材料の割当は運用側で後から。
INSERT INTO ingredient_categories (name, sort_order) VALUES
    ('ベース酒', 1),
    ('ビール', 2),
    ('リキュール・シロップ', 3),
    ('割材', 4),
    ('ジュース', 5),
    ('ガーニッシュ', 6),
    ('フード材料', 7)
ON CONFLICT (name) DO NOTHING;

COMMENT ON TABLE ingredient_categories IS '2026-08-17: 材料マスターの分類軸(単一階層)。材料検索・絞り込み用';
COMMENT ON COLUMN ingredients.category_id IS '2026-08-17: 材料カテゴリ(ラベルのみ・原価/在庫ロジック非関与)。NULL=未分類';
