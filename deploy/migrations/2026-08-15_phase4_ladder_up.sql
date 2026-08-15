-- Phase4 UP: 商品ごとの min/max/段(呼値) を再計算し、current をラダーにスナップ（可逆・DOWNは *_down.sql）。
-- 式は server/services/pricingModel.js と一致（floor=原価×1.2 or base×40%、min=max(base×0.5,floor)、
--   max=base×(1.2+0.1×利益率)、step=GREATEST(25,round25((max-min)/12))）。原価割れ厳禁。
-- 対象: is_drink AND is_active AND min<>max（非ロック）。ロック(min=max)は据え置き。
BEGIN;

-- 可逆用の退避表（対象の旧値）。未退避のものだけ入れる（再実行時の二重退避防止）
CREATE TABLE IF NOT EXISTS menu_items_price_backup (
  id INTEGER PRIMARY KEY,
  min_price NUMERIC(10,2), max_price NUMERIC(10,2),
  price_step_up NUMERIC(10,2), price_step_down NUMERIC(10,2),
  current_price NUMERIC(10,2)
);
INSERT INTO menu_items_price_backup (id, min_price, max_price, price_step_up, price_step_down, current_price)
SELECT m.id, m.min_price, m.max_price, m.price_step_up, m.price_step_down, m.current_price
FROM menu_items m
WHERE m.is_drink = TRUE AND m.is_active = TRUE AND m.min_price <> m.max_price
  AND m.id NOT IN (SELECT id FROM menu_items_price_backup);

WITH cost AS (
  SELECT r.menu_item_id AS id,
    SUM(r.usage_quantity * i.cost_per_purchase_unit / NULLIF(i.purchase_quantity, 0)) AS c
  FROM recipes r JOIN ingredients i ON r.ingredient_id = i.id GROUP BY 1
),
calc AS (
  SELECT m.id, m.base_price::numeric AS b, COALESCE(cost.c, 0)::numeric AS c
  FROM menu_items m LEFT JOIN cost ON cost.id = m.id
  WHERE m.is_drink = TRUE AND m.is_active = TRUE AND m.min_price <> m.max_price
),
vals AS (
  SELECT id, b, c,
    (CASE WHEN c > 0 THEN CEIL(c * 1.2 / 25) * 25 ELSE CEIL(b * 0.4 / 25) * 25 END) AS floor,
    ROUND(b * (1.2 + 0.1 * GREATEST(0, LEAST(1, 1 - (CASE WHEN c > 0 THEN c / b ELSE 0 END)))) / 25) * 25 AS maxp0
  FROM calc
),
vals2 AS (
  SELECT id, GREATEST(ROUND(b * 0.5 / 25) * 25, floor) AS minp, GREATEST(maxp0, GREATEST(ROUND(b * 0.5 / 25) * 25, floor)) AS maxp
  FROM vals
),
vals3 AS (
  SELECT id, minp, maxp, GREATEST(25, ROUND((maxp - minp) / 12 / 25) * 25) AS step FROM vals2
)
UPDATE menu_items m SET
  min_price = v.minp,
  max_price = v.maxp,
  price_step_up = v.step,
  price_step_down = v.step,
  current_price = LEAST(v.maxp, v.minp + ROUND((LEAST(v.maxp, GREATEST(v.minp, m.current_price)) - v.minp) / v.step) * v.step)
FROM vals3 v WHERE m.id = v.id;

COMMIT;
