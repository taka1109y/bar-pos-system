-- 2026-08-18 up: 「ショット＆ワイン」を価格変動・暴落の対象外にする（オーナー指定）。
-- engine_enabled=false（自動変動させない）／ crash_eligible=false（暴落対象外）。
-- deprecated crash_enabled も同値同期（旧暴落経路 WHERE crash_enabled=TRUE 対策）。
-- off銘柄はシステム標準どおり current_price を定価(base_price)へ固定（menu.js の
-- engine_enabled true→false 挙動と同じ。soft_floor率0.8化で soft_floor≠base のため base を使う）。
--   ・暴落中(is_crashed=true)・base=0(時価/price_editable) の商品は current_price を据え置く。
--   ・min/max/idle/is_crashed は変更しない（減衰・寄り付き(market open)対象からも外れる）。
-- 対象はカテゴリ名で解決（環境間の id 差異に強い）。
-- 可逆: 変更前値を backup 表へ退避。冪等（IF NOT EXISTS で再実行時も初回退避を保持、UPDATE も冪等）。

CREATE TABLE IF NOT EXISTS menu_items_shotwine_flag_backup AS
  SELECT m.id, m.engine_enabled, m.crash_eligible, m.crash_enabled, m.current_price
  FROM menu_items m JOIN categories c ON c.id = m.category_id
  WHERE c.name = 'ショット＆ワイン';

UPDATE menu_items m
SET engine_enabled = FALSE,
    crash_eligible  = FALSE,
    crash_enabled   = FALSE,
    current_price   = CASE WHEN m.base_price > 0 AND m.is_crashed = FALSE
                          THEN m.base_price ELSE m.current_price END
FROM categories c
WHERE c.id = m.category_id AND c.name = 'ショット＆ワイン';
