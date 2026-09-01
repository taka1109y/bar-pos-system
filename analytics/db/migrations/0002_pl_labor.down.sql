-- 0002_pl_labor の rollback: 追加した列を削除する
ALTER TABLE store_settings
  DROP COLUMN IF EXISTS labor_is_fixed_for_bep;
