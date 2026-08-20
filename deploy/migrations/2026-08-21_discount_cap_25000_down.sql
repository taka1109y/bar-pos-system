-- rollback: monthly_discount_cap を Phase7R 直前の運用値 '6000'(2026-08-16 設定値)へ戻す。
UPDATE system_settings SET value = '6000' WHERE key = 'monthly_discount_cap';
