-- Phase6-0b down: バックアップ表からフラグ値を復元。
UPDATE menu_items m
SET engine_enabled = b.engine_enabled,
    crash_eligible = b.crash_eligible
FROM menu_items_flags_backup_p6 b
WHERE m.id = b.id;

DROP TABLE IF EXISTS menu_items_flags_backup_p6;
