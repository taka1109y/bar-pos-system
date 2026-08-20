-- 2026-08-21 up: 呼値(step)の丸め単位を ¥5 → ¥10 へ(Phase7R2・オーナー承認)。
-- pricingModel.js の STEP_UNIT=10 と同一デプロイで反映すること(live格子と stored の整合。
-- 片方だけだと現在価格が旧¥5格子に取り残され、格子外表示・クランプずれが起きる)。
-- base_price は不変。pricing_base・crash_floor の丸め単位テーブル(unitForBase)は現行維持(変更なし)。
--  pricing_base = round_to_unit(base×1.10)         丸め単位: base<1000→10 / <3000→50 / ≥3000→100(round half up・不変)
--  step         = max(10, floor(pricing_base×0.02 / 10)×10)   ¥10切下げ(旧: ¥5切下げ)
--  floor_grid   = pricing_base − 10step ／ ceiling = pricing_base + 10step
--  min_price(=実効floor) = min( max(floor_grid, 原価×1.2格子上スナップ), ceiling )
--  max_price    = ceiling
--  current_price= 既存 current を新¥10格子へ ROUND スナップ後 [min_price,max_price] クランプ(定価リセットはしない=持ち越し)
-- 対象: engine_on 変動ドリンク(時価/暴落中/ロック除外)。engine_off 固定品(min=max=base)は step 無関係のため対象外。
-- 可逆(全 menu_items を backup)。

CREATE TABLE IF NOT EXISTS menu_items_step10_backup AS
  SELECT id, min_price, max_price, current_price FROM menu_items;

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
  SELECT id, base, cost, cur, pb, GREATEST(10, FLOOR(pb * 0.02 / 10) * 10) AS step FROM c1
),
calc AS (
  SELECT id, cur, pb, step,
    (pb - 10 * step) AS floor_grid,
    (pb + 10 * step) AS ceiling,
    CASE WHEN cost > 0 THEN pb + CEIL((cost * 1.2 - pb) / step) * step ELSE 0 END AS cost_floor,
    (pb + ROUND((cur - pb) / step) * step) AS snapped   -- 既存 current を新¥10格子へ ROUND スナップ
  FROM c2
)
UPDATE menu_items m
SET min_price     = LEAST(GREATEST(calc.floor_grid, calc.cost_floor), calc.ceiling),
    max_price     = calc.ceiling,
    current_price = LEAST(calc.ceiling,
                     GREATEST(LEAST(GREATEST(calc.floor_grid, calc.cost_floor), calc.ceiling), calc.snapped))
FROM calc WHERE m.id = calc.id;
