-- 2026-08-27 up: ショット＆ワイン(engine_off・常に定価)の残置 min/max を base_price に揃える(min=max=base の完全固定へ)。
-- 経緯: 2026-08-18_shotwine_no_engine は「min/max は変更しない」設計だったが、他の engine_off ドリンク
--       (高額グラス等)は pricing_base_grid の②で min=max=base に畳まれている。表示・整合の一貫性のため揃える。
-- 影響: engine_off ゆえ価格変動・暴落・寄り付き の対象外で、min/max は稼働に使われない(表示は variable=false=無色)。
--       current_price は既に base(=定価)のため変更しない。機能影響なし・純粋な stored データ整形。
-- 対象: category='ショット＆ワイン' かつ engine_enabled=FALSE かつ 非暴落 かつ base>0 かつ min<>max(残置のみ)。
-- 可逆: 変更前の min/max/current を backup 表へ退避。冪等(min<>max ガード / CREATE ... IF NOT EXISTS)。
CREATE TABLE IF NOT EXISTS menu_items_shotwine_minmax_backup AS
  SELECT id, min_price, max_price, current_price FROM menu_items
  WHERE category_id = (SELECT id FROM categories WHERE name = 'ショット＆ワイン')
    AND engine_enabled = FALSE AND min_price <> max_price;

UPDATE menu_items
  SET min_price = base_price, max_price = base_price
  WHERE category_id = (SELECT id FROM categories WHERE name = 'ショット＆ワイン')
    AND engine_enabled = FALSE AND is_crashed = FALSE AND base_price > 0 AND min_price <> max_price;
