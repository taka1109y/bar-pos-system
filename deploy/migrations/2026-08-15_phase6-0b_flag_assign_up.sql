-- Phase6-0b up: 初期フラグ割当(engine_enabled/crash_eligible)。可逆(バックアップ表 + down)。
-- 運用方針: ノンアル品・フード・裏メニュー(客側非表示)・ボトル・時価・薄利指定品は「常に定価」。
--           価格変動・暴落の対象にしない(engine_enabled=false)。
-- 割当ルール:
--   off/off : 非ドリンク(フード) / 裏メニュー / 時価(price_editable) / ノンアルカテゴリ / ボトル / 藍茜・萌黄(薄利)
--   off/on  : 上記以外のドリンクで base_price>=2000 (高額グラス。変動なし・暴落は目玉枠で可)
--   on/on   : その他(通常アルコールドリンク)

DROP TABLE IF EXISTS menu_items_flags_backup_p6;
CREATE TABLE menu_items_flags_backup_p6 AS
  SELECT id, engine_enabled, crash_eligible FROM menu_items;

UPDATE menu_items m
SET engine_enabled = sub.eng,
    crash_eligible = sub.crash
FROM (
  SELECT m.id,
    -- engine_enabled(自動変動させるか)
    (CASE
       WHEN NOT m.is_drink THEN FALSE
       WHEN c.name = '裏メニュー' THEN FALSE
       WHEN m.price_editable THEN FALSE
       WHEN c.name ILIKE '%ノンアル%' THEN FALSE
       WHEN m.name ILIKE '%ボトル%' THEN FALSE
       WHEN m.name IN ('藍茜','萌黄') THEN FALSE     -- 薄利につき対象外
       WHEN m.base_price >= 2000 THEN FALSE           -- 高額グラス(off)
       ELSE TRUE
     END) AS eng,
    -- crash_eligible(暴落対象にできるか)
    (CASE
       WHEN NOT m.is_drink THEN FALSE
       WHEN c.name = '裏メニュー' THEN FALSE
       WHEN m.price_editable THEN FALSE
       WHEN c.name ILIKE '%ノンアル%' THEN FALSE
       WHEN m.name ILIKE '%ボトル%' THEN FALSE
       WHEN m.name IN ('藍茜','萌黄') THEN FALSE     -- 薄利につき暴落も対象外
       WHEN m.base_price >= 2000 THEN TRUE            -- 高額グラス(on=目玉枠)
       ELSE TRUE
     END) AS crash
  FROM menu_items m JOIN categories c ON c.id = m.category_id
) sub
WHERE m.id = sub.id;
