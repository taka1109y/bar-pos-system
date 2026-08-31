-- ============================================================================
-- bardb の全テーブル・シーケンスに対する SELECT 権限を bar_ro へ付与する（冪等）
--
-- 実行（ana.sh grant / ana.sh refresh が発行する）:
--   docker compose exec -T postgres psql -U bar -d bardb -v ON_ERROR_STOP=1 \
--     -f - < analytics/db/bardb-grant-select.sql
--
-- - deploy/fetch-prod-snapshot.sh は bardb を DROP → CREATE → 復元するため、
--   DB 内の GRANT と ALTER DEFAULT PRIVILEGES は毎回失われる。復元のたびに再実行すること
-- - ALTER DEFAULT PRIVILEGES FOR ROLE bar により、以後 bar が作るテーブルにも自動で SELECT が付く
--   （マイグレーションで追加されるテーブルに追従）
-- - 書き込み系権限（INSERT/UPDATE/DELETE/TRUNCATE/CREATE）は一切付与しない
-- ============================================================================
\set ON_ERROR_STOP on

GRANT CONNECT ON DATABASE bardb TO bar_ro;
GRANT USAGE ON SCHEMA public TO bar_ro;
REVOKE CREATE ON SCHEMA public FROM bar_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO bar_ro;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO bar_ro;
ALTER DEFAULT PRIVILEGES FOR ROLE bar IN SCHEMA public GRANT SELECT ON TABLES TO bar_ro;
ALTER DEFAULT PRIVILEGES FOR ROLE bar IN SCHEMA public GRANT SELECT ON SEQUENCES TO bar_ro;
