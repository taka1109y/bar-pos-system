-- ============================================================================
-- bardb を「読み取り専用」で参照するロール bar_ro を作成／更新する（冪等）
--
-- 実行（ana.sh grant が発行する。パスワードは .env の BARDB_RO_PASSWORD から渡す）:
--   docker compose exec -T postgres psql -U bar -d postgres -v ON_ERROR_STOP=1 \
--     -v ro_pass='<password>' -f - < analytics/db/bardb-readonly-role.sql
--
-- - ロールはクラスタ全体のオブジェクトなので、bardb を DROP/CREATE で復元しても消えない
--   （DB 内の権限は消えるため、復元後は bardb-grant-select.sql を再実行すること）
-- - default_transaction_read_only=on / statement_timeout=30s はロール既定値として保存
--   （セッションで上書き可能だが、書き込み権限自体を持たないため実害はない＝多層防御）
-- - パスワードは接続 URL に埋め込むため英数字のみを推奨（記号は URL エンコードが必要）
-- ============================================================================
\set ON_ERROR_STOP on

-- 未作成なら作成（LOGIN のみ・昇格系の属性は一切与えない）
SELECT format('CREATE ROLE bar_ro LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD %L', :'ro_pass')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bar_ro') \gexec

-- 既存でも .env のパスワードに揃える（パスワード変更に追従）
SELECT format('ALTER ROLE bar_ro WITH PASSWORD %L', :'ro_pass') \gexec

ALTER ROLE bar_ro SET default_transaction_read_only = on;
ALTER ROLE bar_ro SET statement_timeout = '30s';
ALTER ROLE bar_ro SET search_path = public;
