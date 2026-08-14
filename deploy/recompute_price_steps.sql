-- 価格変動幅の一括再計算（1回きりの手動実行）
-- 目的: ほぼ全ドリンクが step_up=50/step_down=25 で画一的なため、原価率を反映して
--       商品ごとに変動幅をバラけさせる。あわせて min_price を原価×1.2(セーフティネット)へ底上げ。
-- 対象: 非ロック(min<>max) かつ is_drink かつ is_active かつ 原価>0 のドリンクのみ。
--       「変動無効」= min=max のロック商品 / 原価データ無し / フード(is_drink=false) は据え置き。
-- 係数: 中程度。利益率 m=clamp(1-cost/base,0,1)。step_up=base*0.07*(0.5+m)、step_down=その半分。
-- 実行前に SELECT 版でドライラン推奨。current_price は変更しない。
WITH cost AS (
  SELECT r.menu_item_id AS id,
    SUM(r.usage_quantity * i.cost_per_purchase_unit / NULLIF(i.purchase_quantity, 0)) AS c
  FROM recipes r JOIN ingredients i ON r.ingredient_id = i.id
  GROUP BY r.menu_item_id
),
calc AS (
  SELECT m.id,
    LEAST(1, GREATEST(0, 1 - cost.c / NULLIF(m.base_price, 0))) AS margin,
    m.base_price AS b, cost.c AS c, m.max_price AS maxp, m.min_price AS minp
  FROM menu_items m JOIN cost ON cost.id = m.id
  WHERE m.is_drink = TRUE AND m.is_active = TRUE AND m.min_price <> m.max_price AND cost.c > 0
)
UPDATE menu_items m SET
  price_step_up   = GREATEST(10, LEAST(100, ROUND(calc.b * 0.07  * (0.5 + calc.margin) / 5) * 5)),
  price_step_down = GREATEST(5,  LEAST(50,  ROUND(calc.b * 0.035 * (0.5 + calc.margin) / 5) * 5)),
  min_price       = LEAST(calc.maxp, GREATEST(calc.minp, CEIL(calc.c * 1.2 / 25) * 25))
FROM calc WHERE m.id = calc.id;
