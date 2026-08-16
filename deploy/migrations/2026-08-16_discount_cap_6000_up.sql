-- 6-7 月次値引き費用上限(monthly_discount_cap)の初期値を 6000 円に設定(オーナー指定)。
-- 6-7 マイグレーション(2026-08-15)は既定 '0'(無効)で導入済み。本番運用値として 6000 を設定する。
-- 0 = 上限無効。>0 = 当月の値引き費用累計がこの額を超えると売上管理にアラート。
INSERT INTO system_settings (key, value) VALUES ('monthly_discount_cap', '6000')
ON CONFLICT (key) DO UPDATE SET value = '6000';
