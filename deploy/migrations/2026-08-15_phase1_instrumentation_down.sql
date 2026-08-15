-- 計装フェーズ1 DOWN マイグレーション（ロールバック）
-- 注意: price_events / base_price_history に蓄積したデータは失われる。実行前にバックアップ必須。
-- コード側（pricingEngine の price_events 書込・剪定ガード、menu.js の各書込、
--   pricingSettings の既定0）は、このSQLと対になるコードのリバート(git revert)で戻す。

BEGIN;

DROP TABLE IF EXISTS price_events;
DROP TABLE IF EXISTS base_price_history;

-- 剪定を従来(600秒=10分)に戻す。コードのリバートで既定600に戻るため設定キーは削除する
DELETE FROM system_settings WHERE key = 'pricing_prune_events_seconds';

COMMIT;
