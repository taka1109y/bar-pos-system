-- Phase6-0 up: フラグ列 engine_enabled / crash_eligible / idle_periods を追加。
-- crash_enabled は drop せず deprecated として残置(ロールバック安全性優先)。
-- 冪等(ADD COLUMN IF NOT EXISTS)。適用後の初期フラグ値割当は別途(承認後にデータ移行)。

ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS engine_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS crash_eligible BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS idle_periods   INTEGER NOT NULL DEFAULT 0;

-- 既存 crash_enabled の値を crash_eligible に初期同期(以後は crash_eligible を正とする)
UPDATE menu_items SET crash_eligible = crash_enabled;

COMMENT ON COLUMN menu_items.crash_enabled  IS 'DEPRECATED(Phase6): crash_eligible へ移行。ロールバック用に残置。参照しないこと';
COMMENT ON COLUMN menu_items.engine_enabled IS 'Phase6: 価格エンジンで自動変動させるか(false=手動/固定)';
COMMENT ON COLUMN menu_items.crash_eligible IS 'Phase6: 暴落対象にできるか';
COMMENT ON COLUMN menu_items.idle_periods   IS 'Phase6: 在店かつ無注文の連続期カウンタ(DECAY_IDLE_PERIODS で −1段)';
