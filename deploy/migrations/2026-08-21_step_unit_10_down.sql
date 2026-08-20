-- 2026-08-21 down: 呼値¥10化(step_unit_10)を rollback。backup から min/max/current を復元し backup 表を破棄。
-- ※ロールバック時は pricingModel.js の STEP_UNIT も 5 に戻すこと(コードとstoredを同一デプロイで整合させる)。
UPDATE menu_items m
SET min_price = b.min_price, max_price = b.max_price, current_price = b.current_price
FROM menu_items_step10_backup b WHERE m.id = b.id;

DROP TABLE IF EXISTS menu_items_step10_backup;
