-- Phase6-0 down: 追加したフラグ列を削除。crash_enabled は元から存在するため触らない。
ALTER TABLE menu_items DROP COLUMN IF EXISTS engine_enabled;
ALTER TABLE menu_items DROP COLUMN IF EXISTS crash_eligible;
ALTER TABLE menu_items DROP COLUMN IF EXISTS idle_periods;
COMMENT ON COLUMN menu_items.crash_enabled IS NULL;
