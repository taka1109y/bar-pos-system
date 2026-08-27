-- 2026-08-27 up: フード(engine_off・is_drink=FALSE・価格変動なし)の残置 min/max を base_price に揃える(min=max=base)。
-- 経緯: フードは当初から engine_off だが、初期の phase4/phase6-1 格子再計算で min/max に旧帯が付与され残置
--       (pricing_base_grid の②畳み込みは is_drink=TRUE のドリンクのみ対象だったため)。
--       ショット＆ワインと同様、価格固定(定価)を stored にも反映して統一する。
-- 影響: engine_off かつ is_drink=FALSE ゆえ価格変動/暴落/寄り付き 対象外・板(/api/prices は is_drink=TRUE)非掲載。
--       表示は無色、current は既に base(=定価)のため変更しない。機能影響なし・純粋な stored データ整形。
-- 対象: category='フード' かつ engine_enabled=FALSE かつ 非暴落 かつ base>0 かつ min<>max(残置のみ)。
-- 可逆: 変更前 min/max/current を backup 表へ退避。冪等(min<>max ガード / CREATE ... IF NOT EXISTS)。
CREATE TABLE IF NOT EXISTS menu_items_food_minmax_backup AS
  SELECT id, min_price, max_price, current_price FROM menu_items
  WHERE category_id = (SELECT id FROM categories WHERE name = 'フード')
    AND engine_enabled = FALSE AND min_price <> max_price;

UPDATE menu_items
  SET min_price = base_price, max_price = base_price
  WHERE category_id = (SELECT id FROM categories WHERE name = 'フード')
    AND engine_enabled = FALSE AND is_crashed = FALSE AND base_price > 0 AND min_price <> max_price;
