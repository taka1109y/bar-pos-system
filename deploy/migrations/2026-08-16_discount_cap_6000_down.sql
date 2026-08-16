-- rollback: monthly_discount_cap を 6-7 導入時の既定 '0'(上限無効)へ戻す。
UPDATE system_settings SET value = '0' WHERE key = 'monthly_discount_cap';
