-- Phase6-1 up: 価格を格子(呼値ラダー)へ再計算。可逆(バックアップ表 + down)。
-- 対象: is_drink=TRUE AND is_active=TRUE AND price_editable=FALSE(時価は除外)。
-- step: base<1000→30 / 1000≤base<3000→100 / base≥3000→200 (base で決定・固定)。
-- 格子スナップ snapGrid(x) = base + round_half_up((x-base)/step)*step  ※中間は切り上げ(FLOOR(v+0.5))。
--   min      = soft_floor = base
--   max      = snapGrid(base×1.2)  (< min の場合は min に丸める)
--   current  = clamp( snapGrid(current_old), [min, max] )
-- anchor(寄り付き=base×1.1) は書き込まない(market_open の単一責務)。
-- price_step_up/price_step_down は当該 step を格納。

-- バックアップ(冪等: 作り直す)
DROP TABLE IF EXISTS menu_items_price_backup_p6;
CREATE TABLE menu_items_price_backup_p6 AS
  SELECT id, base_price, min_price, max_price, current_price, price_step_up, price_step_down
  FROM menu_items;

WITH g AS (
  SELECT id,
    base_price::float AS base,
    (CASE WHEN base_price < 1000 THEN 30
          WHEN base_price < 3000 THEN 100
          ELSE 200 END)::float AS step,
    current_price::float AS cur
  FROM menu_items
  WHERE is_drink = TRUE AND is_active = TRUE AND price_editable = FALSE
),
calc AS (
  SELECT id, base, step, cur,
    base AS soft,
    base + FLOOR((base*0.2)/step + 0.5)*step AS maxp
  FROM g
)
UPDATE menu_items m
SET min_price       = calc.soft,
    max_price       = GREATEST(calc.maxp, calc.soft),
    price_step_up   = calc.step,
    price_step_down = calc.step,
    current_price   = GREATEST(calc.soft,
                        LEAST(GREATEST(calc.maxp, calc.soft),
                              calc.base + FLOOR((calc.cur - calc.base)/calc.step + 0.5)*calc.step))
FROM calc
WHERE m.id = calc.id;
