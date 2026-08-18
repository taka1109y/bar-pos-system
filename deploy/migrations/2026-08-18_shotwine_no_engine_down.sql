-- 2026-08-18 down: ショット＆ワインのフラグ/価格を変更前へ復元し backup 表を削除。
-- backup には up 実行直前の engine_enabled/crash_eligible/crash_enabled/current_price を退避済み。
UPDATE menu_items m
SET engine_enabled = b.engine_enabled,
    crash_eligible  = b.crash_eligible,
    crash_enabled   = b.crash_enabled,
    current_price   = b.current_price
FROM menu_items_shotwine_flag_backup b
WHERE m.id = b.id;

DROP TABLE IF EXISTS menu_items_shotwine_flag_backup;
