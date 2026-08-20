-- Phase7R: 月次値引き費用上限(monthly_discount_cap)を 6000 → 25000 円へ引き上げ(オーナー指定)。
-- 理由: 暴落深度の復元(crash_floor=pricing_base×比率)後の9月想定 ≈ 8晩×3千円 ≈ 24000円。
-- 6000 のままだと初週で恒常アラート化し計器(上限監視)が機能しなくなるため 25000 に設定する。
-- 0 = 上限無効。>0 = 当月の値引き費用累計がこの額を超えると売上管理にアラート。
INSERT INTO system_settings (key, value) VALUES ('monthly_discount_cap', '25000')
ON CONFLICT (key) DO UPDATE SET value = '25000';
