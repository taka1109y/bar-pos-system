-- soft_floor_ratio 1.0 → 0.8(オーナー承認)。減衰の停止点(min_price)を再計算。可逆(バックアップ表 + down)。
-- soft_floor = snapGrid(base×0.8)。ただし原価×1.2(格子・ceil)が上回る薄利銘柄は
-- そちら(=hard_floorの原価成分)へクランプ(effectiveSoftFloor)。max/current は据え置き
-- (current は新min未満のときのみ引き上げ)。対象: is_drink AND is_active AND price_editable=FALSE。
-- step: base<1000→30 / <3000→100 / ≥3000→200。snapGrid=base+round_half_up((x-base)/step)*step。

-- バックアップ表は IF NOT EXISTS で作成する(誤って up を再実行しても最初の 1.0 値の
-- バックアップを保持し、可逆性を壊さない。UPDATE は格子上で冪等=再実行しても no-op)。
-- ※初回適用前に古い backup 表が残っていないこと(= down 済み or 未適用)を前提とする。
CREATE TABLE IF NOT EXISTS menu_items_softfloor_backup AS
  SELECT id, min_price, max_price, current_price FROM menu_items;

WITH rc AS (
  SELECT r.menu_item_id,
    COALESCE(SUM(r.usage_quantity * i.cost_per_purchase_unit / NULLIF(i.purchase_quantity, 0)), 0) AS cost
  FROM recipes r JOIN ingredients i ON i.id = r.ingredient_id GROUP BY r.menu_item_id
),
g AS (
  SELECT m.id,
    m.base_price::float AS base,
    COALESCE(rc.cost, 0)::float AS cost,
    (CASE WHEN m.base_price < 1000 THEN 30 WHEN m.base_price < 3000 THEN 100 ELSE 200 END)::float AS step,
    m.current_price::float AS cur
  FROM menu_items m LEFT JOIN rc ON rc.menu_item_id = m.id
  -- computeLadder の variable(=isDrink && !priceEditable && !locked)と同一スコープ + 暴落中除外。
  -- min<>max: price_locked(緊急固定)/縮退品を除外(誤ってロック解除しない)。
  -- is_crashed=FALSE: 暴落中の current(=hard_floor)を新minまで引き上げてしまう事故を防ぐ(recipes.js と同じガード)。
  WHERE m.is_drink = TRUE AND m.is_active = TRUE AND m.price_editable = FALSE
    AND m.is_crashed = FALSE
    AND m.min_price <> m.max_price
),
calc AS (
  SELECT id, base, cur,
    -- soft_floor(base×0.8, 格子) と 原価×1.2(格子・ceil) の高い方 = effectiveSoftFloor
    GREATEST(
      base + FLOOR((base*0.8 - base)/step + 0.5)*step,
      CASE WHEN cost > 0 THEN base + CEIL((cost*1.2 - base)/step)*step ELSE 0 END
    ) AS newmin,
    base + FLOOR((base*0.2)/step + 0.5)*step AS maxp
  FROM g
)
UPDATE menu_items m
SET min_price     = LEAST(calc.newmin, calc.maxp),
    max_price     = calc.maxp,
    current_price = LEAST(calc.maxp, GREATEST(LEAST(calc.newmin, calc.maxp), calc.cur))
FROM calc
WHERE m.id = calc.id;

-- 注) monthly_discount_cap の 6000 設定は別マイグレーション
--     (2026-08-16_discount_cap_6000_up.sql)に分離。ロールバックを独立させるため。
