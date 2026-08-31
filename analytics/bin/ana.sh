#!/usr/bin/env bash
# ============================================================================
# ana.sh — 分析サイト（analytics/・ローカル専用）の運用コマンド
#
#   ./analytics/bin/ana.sh <subcommand> [args]
#
#   up             分析スタック（analytics-postgres / analytics-server / analytics-web）をビルド・起動。
#                  bardb 読み取り専用ロールの grant を行い、health を確認して要約表示する
#   dev            analytics-postgres / analytics-server のみを dev 構成（ホットリロード・127.0.0.1:3101 公開）で起動し、
#                  フロント開発サーバーの起動手順を案内する（自動起動はしない）
#   down           分析スタックの 3 サービスだけを停止・削除する（analyticsdb のボリュームは保持。-v は付けない）
#   ps             コンテナ一覧
#   logs [service] ログ表示（既定: 分析 3 サービス）
#   grant          bardb に読み取り専用ロール bar_ro を作成／更新し、全テーブルの SELECT 権限を付与する（冪等）
#   backup         analyticsdb を backups/analytics/analyticsdb_<ts>.sql へ pg_dump
#   restore <file> 現状を backup した上で analyticsdb を <file> から復元する
#   refresh        確認 → backup → analytics-server 停止 → 本番スナップショット取得（deploy/fetch-prod-snapshot.sh）
#                  → grant → analytics-server 起動 → 取込を記録（POST /api/v1/meta/sync）→ verify
#                  （ローカル bardb を作り直すため実行前に確認する。ANA_YES=1 で省略可。fetch 失敗時は grant 再付与と
#                    analytics-server の稼働確認を行い、状態と復旧手順を表示して exit 1）
#   verify         整合性チェック（POST /api/v1/meta/verify）を実行し表形式で表示。1 件でも NG なら exit 1
#
# 安全設計:
#   - 既存の POS スタック（bar-pos-postgres / bar-pos-server / bar-pos-client）は起動・停止・再作成しない。
#     down / stop / start は必ず分析サービス名を明示する（素の `down` は既存 3 コンテナも落とすので禁止）
#   - `docker compose down -v` は絶対に発行しない（analyticsdb を失う）
#   - .env の値（パスワード）は一切表示しない
#   - docker compose には常に "-f docker-compose.yml -f docker-compose.analytics.yml --profile analytics" を渡す
#     （COMPOSE_FILE 環境変数は使わない）
#   - `up` の前に、稼働中 bar-pos-postgres の compose 設定ハッシュが一致することを確認し、
#     依存先として postgres が再作成されてしまう事故を防ぐ
# ============================================================================
set -euo pipefail

# リポジトリ root へ移動（analytics/bin/ana.sh → ../..）
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

ENV_FILE=".env"
BK_DIR="backups/analytics"
BASE_URL="${ANA_BASE_URL:-http://127.0.0.1:8080}"
DEV_FILE="docker-compose.analytics.dev.yml"
ROLE_SQL="analytics/db/bardb-readonly-role.sql"
GRANT_SQL="analytics/db/bardb-grant-select.sql"
FETCH_SCRIPT="./deploy/fetch-prod-snapshot.sh"
ANALYTICS_SERVICES=(analytics-postgres analytics-server analytics-web)
COMPOSE_FILES=(-f docker-compose.yml -f docker-compose.analytics.yml)
LAST_BACKUP=""

# ---------------------------------------------------------------------------
# 共通ヘルパ
# ---------------------------------------------------------------------------
log()  { printf '▶ %s\n' "$*"; }
ok()   { printf '✅ %s\n' "$*"; }
warn() { printf '⚠️  %s\n' "$*" >&2; }
die()  { printf '❌ %s\n' "$*" >&2; exit 1; }

# docker compose ラッパ（常に既存 compose + analytics compose + profile analytics）
compose() { docker compose "${COMPOSE_FILES[@]}" --profile analytics "$@"; }

need_cmd() { command -v "$1" >/dev/null 2>&1 || die "$1 が必要です${2:+（$2）}"; }

# .env から KEY の値を取り出す（表示はしない）。環境変数として export 済みならそれを優先
env_get() {
  local key="$1" line
  if [ -n "${!key:-}" ]; then printf '%s' "${!key}"; return 0; fi
  [ -f "$ENV_FILE" ] || return 1
  line="$(grep -E "^[[:space:]]*${key}=" "$ENV_FILE" | tail -1 || true)"
  [ -n "$line" ] || return 1
  line="${line#*=}"
  # 前後の空白と囲みクォートを除去
  line="${line#"${line%%[![:space:]]*}"}"
  line="${line%"${line##*[![:space:]]}"}"
  case "$line" in
    \"*\") line="${line#\"}"; line="${line%\"}" ;;
    \'*\') line="${line#\'}"; line="${line%\'}" ;;
  esac
  printf '%s' "$line"
}

# 必要な .env キーが設定されているか（値は出力しない）
require_env() {
  local k v missing=0
  for k in "$@"; do
    v="$(env_get "$k" || true)"
    if [ -z "$v" ]; then warn ".env に $k が設定されていません"; missing=1; fi
  done
  [ "$missing" = 0 ] || die "必要な環境変数が不足しています（.env に追記してください。値は英数字のみ推奨。.env.example 参照）"
}

container_status()  { docker inspect -f '{{.State.Status}}' "$1" 2>/dev/null || true; }
container_running() { [ "$(container_status "$1")" = "running" ]; }
ensure_running()    { container_running "$1" || die "$1 が稼働していません（先に: $0 up）"; }

confirm() {
  if [ "${ANA_YES:-}" = "1" ]; then return 0; fi
  local a
  read -r -p "$1 [y/N] " a
  case "$a" in y|Y|yes|YES) ;; *) die "中止しました" ;; esac
}

# 既存 POS スタックを巻き込まないためのガード
#  - bar-pos-postgres が稼働中であること（既存側の起動はここでは行わない）
#  - 結合した compose 定義の postgres 設定ハッシュが稼働中コンテナと一致すること
#    （不一致だと `up` が依存先 postgres を再作成してしまう）
guard_base_stack() {
  local want have
  container_running bar-pos-postgres \
    || die "bar-pos-postgres が稼働していません。先に既存スタックを起動してください（docker compose up -d）"
  want="$(compose config --hash=postgres 2>/dev/null | awk '{print $2}' || true)"
  have="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.config-hash"}}' bar-pos-postgres 2>/dev/null || true)"
  if [ -n "$want" ] && [ -n "$have" ] && [ "$want" != "$have" ]; then
    die "postgres の compose 設定が稼働中コンテナと異なります（このまま up すると postgres が再作成されます）。中止しました。既存側の設定差分を確認してください"
  fi
}

# health が ok になるまで待つ（引数: 最大秒数）
wait_health() {
  local timeout="${1:-60}" i=0 body
  while [ "$i" -lt "$timeout" ]; do
    if body="$(curl -fsS --max-time 3 "$BASE_URL/api/v1/meta/health" 2>/dev/null)" \
       && printf '%s' "$body" | jq -e '.ok == true' >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    i=$((i + 1))
  done
  return 1
}

show_health() {
  local body
  body="$(curl -fsS --max-time 5 "$BASE_URL/api/v1/meta/health" 2>/dev/null)" || { warn "health に到達できません: $BASE_URL/api/v1/meta/health"; return 1; }
  printf '%s\n' "$body" | jq .
}

# ---------------------------------------------------------------------------
# サブコマンド
# ---------------------------------------------------------------------------
cmd_grant() {
  require_env BARDB_RO_PASSWORD
  container_running bar-pos-postgres || die "bar-pos-postgres が稼働していません"
  local ro_pass n
  ro_pass="$(env_get BARDB_RO_PASSWORD)"
  log "bardb 読み取り専用ロール bar_ro を作成／更新（${ROLE_SQL}）"
  compose exec -T postgres psql -U bar -d postgres -q -v ON_ERROR_STOP=1 -v ro_pass="$ro_pass" -f - < "$ROLE_SQL"
  log "bardb の SELECT 権限を bar_ro へ付与（${GRANT_SQL}）"
  compose exec -T postgres psql -U bar -d bardb -q -v ON_ERROR_STOP=1 -f - < "$GRANT_SQL"
  n="$(compose exec -T postgres psql -U bar -d bardb -t -A \
        -c "SELECT count(DISTINCT table_name) FROM information_schema.role_table_grants WHERE grantee='bar_ro' AND privilege_type='SELECT'" \
        | tr -d '[:space:]')"
  ok "grant 完了: bar_ro に SELECT 付与済みテーブル数 = ${n:-?}"
}

cmd_up() {
  need_cmd jq "brew install jq"; need_cmd curl
  require_env ANALYTICS_DB_PASSWORD BARDB_RO_PASSWORD
  guard_base_stack
  # bar_ro 未作成のまま analytics-server を起動すると自己診断（selfCheck）で落ちて再起動を繰り返すため、先に grant する
  cmd_grant
  log "分析スタックをビルド・起動: ${ANALYTICS_SERVICES[*]}"
  compose up -d --build "${ANALYTICS_SERVICES[@]}"
  log "health 確認: $BASE_URL/api/v1/meta/health"
  if wait_health 90; then
    show_health
    ok "起動完了: $BASE_URL"
  else
    show_health || true
    die "health が ok になりません。ログ: $0 logs analytics-server"
  fi
}

cmd_dev() {
  require_env ANALYTICS_DB_PASSWORD BARDB_RO_PASSWORD
  guard_base_stack
  cmd_grant
  COMPOSE_FILES=("${COMPOSE_FILES[@]}" -f "$DEV_FILE")
  BASE_URL="http://127.0.0.1:3101"
  log "dev 構成で analytics-postgres / analytics-server を起動（node --watch・127.0.0.1:3101 公開）"
  compose up -d --build analytics-postgres analytics-server
  if command -v jq >/dev/null 2>&1 && wait_health 90; then
    ok "analytics-server (dev) 起動: $BASE_URL/api/v1/meta/health"
  else
    warn "health をまだ確認できていません。ログ: $0 logs analytics-server"
  fi
  cat <<MSG

次にフロントの開発サーバーを別ターミナルで起動してください（自動起動はしません）:

  npm install --prefix analytics/client   # 初回のみ
  npm run dev --prefix analytics/client   # http://127.0.0.1:5174/ （/api → 127.0.0.1:3101 へ proxy）

終了: $0 down
MSG
}

cmd_down() {
  # 分析 3 サービスだけを対象にする（引数なしの down は既存 POS の 3 コンテナも落とす）。-v は絶対に付けない
  log "分析スタックを停止・削除: ${ANALYTICS_SERVICES[*]}（analyticsdb のボリュームは保持）"
  compose down "${ANALYTICS_SERVICES[@]}"
  ok "down 完了"
}

cmd_ps() { compose ps; }

cmd_logs() {
  if [ "$#" -gt 0 ]; then
    compose logs --tail=200 -f "$@"
  else
    compose logs --tail=200 -f "${ANALYTICS_SERVICES[@]}"
  fi
}

cmd_backup() {
  ensure_running bar-analytics-postgres
  mkdir -p "$BK_DIR"
  local ts f
  ts="$(date +%Y%m%d_%H%M%S)"
  f="$BK_DIR/analyticsdb_${ts}.sql"
  log "analyticsdb を退避: $f"
  compose exec -T analytics-postgres pg_dump -U analytics analyticsdb > "$f"
  grep -q 'PostgreSQL database dump complete' "$f" || die "ダンプが不完全です（完了マーカーなし）: $f"
  ok "backup 完了: $f ($(wc -c < "$f" | tr -d ' ') bytes)"
  LAST_BACKUP="$f"
}

cmd_restore() {
  local src="${1:-}" server_was_running=0
  [ -n "$src" ] || die "使い方: $0 restore <backups/analytics/analyticsdb_YYYYMMDD_HHMMSS.sql>"
  [ -f "$src" ] || die "ファイルがありません: $src"
  ensure_running bar-analytics-postgres
  warn "analyticsdb の public スキーマを初期化して $src から復元します（現状は直前に backup します）"
  confirm "続行しますか？"
  cmd_backup
  if container_running bar-analytics-server; then
    server_was_running=1
    log "analytics-server を停止（復元中の接続を避ける）"
    compose stop analytics-server
  fi
  log "analyticsdb を初期化して復元"
  compose exec -T analytics-postgres psql -U analytics -d analyticsdb -q -v ON_ERROR_STOP=1 \
    -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
  compose exec -T analytics-postgres psql -U analytics -d analyticsdb -q -v ON_ERROR_STOP=1 -o /dev/null -f - < "$src"
  if [ "$server_was_running" = 1 ]; then
    compose start analytics-server
  fi
  ok "復元完了: ${src}（復元前の状態: ${LAST_BACKUP}）"
}

cmd_verify() {
  need_cmd jq "brew install jq"; need_cmd curl
  local body
  body="$(curl -fsS --max-time 120 -X POST "$BASE_URL/api/v1/meta/verify" -H 'Content-Type: application/json' -d '{}')" \
    || die "verify API に到達できません: $BASE_URL/api/v1/meta/verify"
  printf '%s\n' "$body" | jq -r '
    def pad(n): . + (" " * n) | .[0:n];
    (("CHECK" | pad(22)) + ("RESULT" | pad(8)) + "DETAIL"),
    ("-" * 70),
    (.checks[] |
      ((.check_name // "?") | pad(22)) +
      ((if .ok then "PASS" else "FAIL" end) | pad(8)) +
      ((if .detail == null then "-" else (.detail | tostring) end) | .[0:110]))
  '
  if printf '%s' "$body" | jq -e '(.checks | length) > 0 and all(.checks[]; .ok == true)' >/dev/null; then
    ok "verify: すべて PASS"
  else
    die "verify: FAIL があります（詳細は上の表と $BASE_URL/api/v1/meta/verify/latest）"
  fi
}

# refresh の fetch-prod-snapshot.sh 失敗時の後始末（戻らない: 最後に die）
#  - fetch は失敗した段階により bardb が「未変更 / DROP 後の空・部分復元 / 復元済みだが本番と件数不一致」のいずれかになる。
#    DROP 以降で失敗すると bardb に bar_ro の GRANT が無いため、grant を再実行せずに analytics-server を起動すると
#    selfCheck（can_select=false）で exit 1 → `restart: unless-stopped` の再起動ループになる。
#  - そのため grant を再試行してから起動し、実際に health ok になったかを確認した上で、状態と復旧手順を表示する。
#  - bar-pos-server の起動／bardb の復元は「本番 POS スタックに触れない」方針からここでは自動実行せず、手順のみ案内する。
refresh_fail() {
  local fetch_log="$1" local_bk touched=0 restored=0 phase ana_state pos_state db_state
  local_bk="$(grep -Eo 'backups/local_before_prod_[0-9_]+\.sql' "$fetch_log" | head -1 || true)"
  grep -q '4/6' "$fetch_log" && touched=1
  grep -q '5/6' "$fetch_log" && restored=1
  rm -f "$fetch_log"
  warn "${FETCH_SCRIPT} が失敗しました。後始末を行います（grant 再付与 → analytics-server 起動 → 状態確認）"

  # 1) bardb が作り直されていても bar_ro が SELECT できるよう grant を再試行（冪等。bardb 不在なら失敗する）
  if ( cmd_grant ); then
    ok "grant を再付与しました"
  else
    warn "grant に失敗しました（bardb が存在しない／復元途中の可能性）。bardb を復旧した後に '$0 grant' を実行してください"
  fi

  # 2) analytics-server を起動し、実際に稼働したかを確認（grant 不備なら selfCheck で落ちて再起動ループになる）
  compose start analytics-server >/dev/null 2>&1 || true
  if wait_health 15; then
    ana_state="稼働中（health ok）"
  else
    ana_state="起動できていません（状態: $(container_status bar-analytics-server || true)）。ログ: $0 logs analytics-server"
  fi

  # 3) 周辺の状態（読み取りのみ）
  if container_running bar-pos-server; then pos_state="稼働中"; else pos_state="停止中 → docker compose start server で起動してください"; fi
  if [ "$touched" = 0 ]; then
    phase="ローカル bardb は変更されていません（DROP 前の段階で失敗）"
  elif [ "$restored" = 1 ]; then
    phase="bardb は復元済みですが検証（本番との件数照合）で失敗しました。内容が本番と一致しない可能性があります"
  else
    phase="bardb は DROP 後の復元途中で失敗しました（空または部分復元の状態）"
  fi
  db_state="$(compose exec -T postgres psql -U bar -d postgres -t -A \
    -c "SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_database WHERE datname='bardb') THEN 'あり' ELSE 'なし' END" 2>/dev/null \
    | tr -d '[:space:]' || true)"

  cat >&2 <<MSG

❌ refresh を中止しました（${FETCH_SCRIPT} が失敗）
  状況:
    - ${phase}
    - bardb データベース: ${db_state:-不明}
    - bar-pos-server   : ${pos_state}
    - analytics-server : ${ana_state}
    - analyticsdb の退避: ${LAST_BACKUP:-（なし）}
    - ローカル bardb の退避: ${local_bk:-（退避前に失敗＝bardb は元のまま）}
  復旧手順:
    1) bardb を退避データから戻す場合（DROP 以降で失敗したとき）:
         docker compose ${COMPOSE_FILES[*]} --profile analytics stop analytics-server
         docker compose stop server
         docker compose exec -T postgres psql -U bar -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='bardb' AND pid<>pg_backend_pid();"
         docker compose exec -T postgres psql -U bar -d postgres -c "DROP DATABASE IF EXISTS bardb;" -c "CREATE DATABASE bardb OWNER bar;"
         docker compose exec -T postgres psql -U bar -d bardb -q -v ON_ERROR_STOP=1 -o /dev/null < ${local_bk:-backups/local_before_prod_<ts>.sql}
         docker compose start server
    2) bar_ro の権限を再付与して analytics-server を起動:
         $0 grant && docker compose ${COMPOSE_FILES[*]} --profile analytics start analytics-server
    3) 確認:
         $0 verify
MSG
  exit 1
}

cmd_refresh() {
  need_cmd jq "brew install jq"; need_cmd curl
  require_env BARDB_RO_PASSWORD
  [ -x "$FETCH_SCRIPT" ] || die "$FETCH_SCRIPT が見つからないか実行権限がありません"
  ensure_running bar-analytics-postgres
  [ -n "$(container_status bar-analytics-server)" ] || die "bar-analytics-server が存在しません（先に: $0 up）"
  # restore と同様に、ローカル bardb を作り直す破壊的操作なので実行前に確認する（ANA_YES=1 で省略可）
  warn "ローカル bardb を本番スナップショットで置換します（本番へは読み取りのみ。現行 bardb は ${FETCH_SCRIPT} が backups/local_before_prod_<ts>.sql へ退避し、analyticsdb もこの場で backup します）"
  confirm "ローカル bardb を本番スナップショットで置換します。続行しますか？"
  cmd_backup

  log "analytics-server を停止（bardb 置換中に bar_ro の接続が残らないようにする）"
  compose stop analytics-server

  log "本番スナップショットを取得してローカル bardb を置換: ${FETCH_SCRIPT}（無改変で呼び出し）"
  local fetch_log
  fetch_log="$(mktemp -t ana-refresh.XXXXXX)"
  if ! "$FETCH_SCRIPT" 2>&1 | tee "$fetch_log"; then
    refresh_fail "$fetch_log"
  fi

  # 取得したダンプのファイル名（スクリプトの「取得: backups/prod_snapshot_<ts>.sql」行から。取れなければ最新ファイル）
  local dump_path dump_file
  dump_path="$(grep -Eo 'backups/prod_snapshot_[0-9_]+\.sql' "$fetch_log" | head -1 || true)"
  rm -f "$fetch_log"
  if [ -z "$dump_path" ]; then
    dump_path="$(ls -t backups/prod_snapshot_*.sql 2>/dev/null | head -1 || true)"
  fi
  [ -n "$dump_path" ] || die "取得したダンプファイルを特定できません（backups/prod_snapshot_*.sql）"
  dump_file="$(basename "$dump_path")"

  # DB を作り直したので権限を再付与（失敗したら analytics-server は停止のままなので復旧手順を示す）
  ( cmd_grant ) || die "grant に失敗しました。復旧: $0 grant && docker compose ${COMPOSE_FILES[*]} --profile analytics start analytics-server"

  log "analytics-server を起動"
  compose start analytics-server
  wait_health 15 || die "analytics-server が 15 秒以内に health ok になりません。ログ: $0 logs analytics-server（bar_ro の権限不足なら: $0 grant && docker compose ${COMPOSE_FILES[*]} --profile analytics start analytics-server）"

  log "取込を記録: POST $BASE_URL/api/v1/meta/sync {dump_file: $dump_file}"
  curl -fsS -X POST "$BASE_URL/api/v1/meta/sync" -H 'Content-Type: application/json' \
    -d "$(jq -cn --arg f "$dump_file" '{dump_file: $f}')" | jq -c . || die "sync の記録に失敗しました"

  cmd_verify
  ok "refresh 完了（dump: ${dump_file}）"
}

usage() {
  sed -n '2,/^# =*$/p' "${BASH_SOURCE[0]}" | sed -n '2,$p' | sed 's/^# \{0,1\}//' | sed '$d'
}

# ---------------------------------------------------------------------------
# エントリポイント
# ---------------------------------------------------------------------------
main() {
  local sub="${1:-}"
  [ -n "$sub" ] || { usage; exit 1; }
  shift
  need_cmd docker
  case "$sub" in
    up)      cmd_up "$@" ;;
    dev)     cmd_dev "$@" ;;
    down)    cmd_down "$@" ;;
    ps)      cmd_ps "$@" ;;
    logs)    cmd_logs "$@" ;;
    grant)   cmd_grant "$@" ;;
    backup)  cmd_backup "$@" ;;
    restore) cmd_restore "$@" ;;
    refresh) cmd_refresh "$@" ;;
    verify)  cmd_verify "$@" ;;
    -h|--help|help) usage ;;
    *) warn "不明なサブコマンド: $sub"; usage; exit 1 ;;
  esac
}

main "$@"
