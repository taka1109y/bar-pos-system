-- 0001_init rollback: up の逆順に DROP（IF NOT EXISTS 対応で再実行安全）
-- schema_migrations の行削除は migrate.js が行う
DROP TABLE IF EXISTS verification_runs;
DROP TABLE IF EXISTS snapshot_imports;
DROP TABLE IF EXISTS register_closings;
DROP TABLE IF EXISTS business_day_tags;
DROP TABLE IF EXISTS business_days;
DROP TABLE IF EXISTS tags;
DROP TABLE IF EXISTS targets;
DROP TABLE IF EXISTS shifts;
DROP TABLE IF EXISTS staff_wage_history;
DROP TABLE IF EXISTS staff;
DROP TABLE IF EXISTS recurring_expenses;
DROP TABLE IF EXISTS expenses;
DROP TABLE IF EXISTS expense_categories;
DROP TABLE IF EXISTS seat_capacities;
DROP TABLE IF EXISTS store_settings;
