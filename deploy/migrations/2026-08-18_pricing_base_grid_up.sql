-- 2026-08-18 up: Phase7 価格モデル(pricing_base中心21点格子)へ stored min/max/current を移行。
-- pricingModel.js の Phase7 関数(pricingBase/gridStep/floorPrice/ceilingPrice/effectiveFloor)と
-- 同一デプロイで反映すること(live格子と stored の整合。片方だけだと現在価格が旧帯に取り残される)。
-- base_price は不変。
--  pricing_base = round_to_unit(base×1.10)  丸め単位: base<1000→10 / <3000→50 / ≥3000→100(round half up)
--  step         = max(5, floor(pricing_base×0.02 / 5)×5)   ¥5切下げ→帯は必ず±20%以内
--  floor_grid   = pricing_base − 10step ／ ceiling = pricing_base + 10step
--  min_price(=実効floor) = min( max(floor_grid, 原価×1.2格子上スナップ), ceiling )  ※原価が厳しい銘柄はfloorが持ち上がる
--  max_price    = ceiling ／ current_price = pricing_base(n=0＝寄り付き位置)
-- 対象①: engine_on 変動ドリンク(時価/暴落中/ロック除外)を上記へ再計算。
-- 対象②: engine_off の変動帯ドリンク(時価/暴落中除外)を定価(base)へ固定(常に定価＝markup非適用)。
-- 可逆(全 menu_items を backup)。

CREATE TABLE IF NOT EXISTS menu_items_pbgrid_backup AS
  SELECT id, min_price, max_price, current_price FROM menu_items;

-- ① engine_on 変動ドリンク → Phase7 新格子
WITH rc AS (
  SELECT r.menu_item_id,
    COALESCE(SUM(r.usage_quantity * i.cost_per_purchase_unit / NULLIF(i.purchase_quantity, 0)), 0) AS cost
  FROM recipes r JOIN ingredients i ON i.id = r.ingredient_id GROUP BY r.menu_item_id
),
g AS (
  SELECT m.id, m.base_price::float AS base, COALESCE(rc.cost, 0)::float AS cost, m.current_price::float AS cur,
    (CASE WHEN m.base_price < 1000 THEN 10 WHEN m.base_price < 3000 THEN 50 ELSE 100 END)::float AS unit
  FROM menu_items m LEFT JOIN rc ON rc.menu_item_id = m.id
  WHERE m.is_drink = TRUE AND m.is_active = TRUE AND m.price_editable = FALSE
    AND m.is_crashed = FALSE AND m.engine_enabled = TRUE AND m.min_price <> m.max_price
),
c1 AS (
  SELECT id, base, cost, cur, (FLOOR(base * 1.10 / unit + 0.5) * unit) AS pb FROM g
),
c2 AS (
  SELECT id, base, cost, cur, pb, GREATEST(5, FLOOR(pb * 0.02 / 5) * 5) AS step FROM c1
),
calc AS (
  SELECT id, cur, pb, step,
    (pb - 10 * step) AS floor_grid,
    (pb + 10 * step) AS ceiling,
    CASE WHEN cost > 0 THEN pb + CEIL((cost * 1.2 - pb) / step) * step ELSE 0 END AS cost_floor
  FROM c2
)
UPDATE menu_items m
SET min_price     = LEAST(GREATEST(calc.floor_grid, calc.cost_floor), calc.ceiling),
    max_price     = calc.ceiling,
    current_price = LEAST(calc.ceiling, GREATEST(LEAST(GREATEST(calc.floor_grid, calc.cost_floor), calc.ceiling), calc.pb))
FROM calc WHERE m.id = calc.id;

-- ② engine_off の変動帯ドリンク → 定価(base)固定(常に定価)
UPDATE menu_items
SET min_price = base_price, max_price = base_price, current_price = base_price
WHERE is_drink = TRUE AND is_active = TRUE AND price_editable = FALSE
  AND is_crashed = FALSE AND engine_enabled = FALSE AND min_price <> max_price;
