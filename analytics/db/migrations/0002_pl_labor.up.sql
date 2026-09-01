-- 0002_pl_labor: Phase 4（月次P&L・損益分岐点・人時生産性）で必要な列追加
-- - store_settings.labor_is_fixed_for_bep: 損益分岐点で人件費（labor_total）を固定費扱いするか
--   （FALSE=変動費扱いが既定。BreakevenPage のトグルで PATCH /api/v1/settings から変更する）
-- 可逆: 0002_pl_labor.down.sql が DROP COLUMN IF EXISTS で戻す
-- expenses（recurrence_id / period_month）・shifts は 0001 で作成済みのため追加不要
ALTER TABLE store_settings
  ADD COLUMN IF NOT EXISTS labor_is_fixed_for_bep BOOLEAN NOT NULL DEFAULT FALSE;
