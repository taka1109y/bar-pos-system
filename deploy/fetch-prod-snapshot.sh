#!/usr/bin/env bash
# 本番DBのスナップショットを取得し、ローカルの bardb を置き換える（売上分析用）。
#
#   使い方:  PROD_SSH=user@host ./deploy/fetch-prod-snapshot.sh
#            （または deploy/.prod-ssh に "user@host" を1行で保存しておく）
#
# 安全設計:
#  - 本番へは pg_dump の「読み取り」のみ。出力をSSHで直接ローカルへストリームするため、
#    本番(Pi)側にファイルを一切作らない。
#  - 実行前にローカル現行DBを backups/ へ退避するので、いつでも元に戻せる。
#  - 接続先はスクリプトに書かない（公開リポジトリのため）。環境変数か gitignore 済みの
#    deploy/.prod-ssh から読む。
#  - 取得したダンプは backups/ に置く（.gitignore 済み＝コミットされない）。
set -euo pipefail

cd "$(dirname "$0")/.."
BK_DIR="backups"; mkdir -p "$BK_DIR"
TS="$(date +%Y%m%d_%H%M%S)"

# ── 接続先の解決（ハードコードしない） ──
if [ -z "${PROD_SSH:-}" ] && [ -f deploy/.prod-ssh ]; then
  PROD_SSH="$(head -1 deploy/.prod-ssh | tr -d '[:space:]')"
fi
if [ -z "${PROD_SSH:-}" ]; then
  cat >&2 <<'USAGE'
エラー: 本番の接続先が未設定です。

  PROD_SSH=user@host ./deploy/fetch-prod-snapshot.sh

もしくは接続先を1行だけ書いたファイルを用意してください（gitignore 済み）:
  echo 'user@host' > deploy/.prod-ssh
USAGE
  exit 1
fi

echo "▶ 1/6 本番からスナップショット取得（読み取りのみ・Pi上にファイルを作りません）"
SNAP="$BK_DIR/prod_snapshot_${TS}.sql"
ssh -o BatchMode=yes "$PROD_SSH" 'sudo docker exec bar-pos-postgres pg_dump -U bar bardb' > "$SNAP"
if [ "$(grep -c 'PostgreSQL database dump complete' "$SNAP")" -ne 1 ]; then
  echo "エラー: ダンプが不完全です（完了マーカーなし）。中止します: $SNAP" >&2; exit 1
fi
echo "   取得: $SNAP ($(wc -c < "$SNAP" | tr -d ' ') bytes / $(wc -l < "$SNAP" | tr -d ' ') 行)"

echo "▶ 2/6 PostgreSQL バージョン差の吸収"
# 本番(16.14+)のダンプに含まれる \restrict / \unrestrict は psql 16.13 以前では構文エラーになる。
# ローカルが未対応なら除去したコピーを作る（原本は保全）。
LOCAL_PG="$(docker compose exec -T postgres psql -U bar -d postgres -t -A -c 'SHOW server_version;' | tr -d '[:space:]')"
RESTORE="$SNAP"
if [ "$(printf '%s\n' "$LOCAL_PG" "16.14" | sort -V | head -1)" != "16.14" ]; then
  RESTORE="${SNAP%.sql}_compat.sql"
  grep -vE '^\\(un)?restrict' "$SNAP" > "$RESTORE"
  echo "   ローカル $LOCAL_PG のため \\restrict を除去したコピーを使用: $RESTORE"
else
  echo "   ローカル $LOCAL_PG はそのまま復元可能"
fi

echo "▶ 3/6 ローカル現行データを退避（復旧用）"
LOCAL_BK="$BK_DIR/local_before_prod_${TS}.sql"
docker compose exec -T postgres pg_dump -U bar bardb > "$LOCAL_BK"
echo "   退避: $LOCAL_BK  ※戻すには server 停止 → DB作り直し → このファイルを復元"

echo "▶ 4/6 ローカル bardb を本番データで置換"
docker compose stop server >/dev/null
docker compose exec -T postgres psql -U bar -d postgres -q \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='bardb' AND pid<>pg_backend_pid();" >/dev/null
docker compose exec -T postgres psql -U bar -d postgres -q -c "DROP DATABASE IF EXISTS bardb;" -c "CREATE DATABASE bardb OWNER bar;" >/dev/null
docker compose exec -T postgres psql -U bar -d bardb -q -v ON_ERROR_STOP=1 -o /dev/null < "$RESTORE"

echo "▶ 5/6 分析UIを開けるようにする（ローカル限定）"
# 本番データは register_open=false のため、そのままだと / が /start へリダイレクトされ
# 「売上管理」画面に到達できない。register_opened_at は本番値のまま維持する。
docker compose exec -T postgres psql -U bar -d bardb -q -c "UPDATE system_settings SET value='true' WHERE key='register_open';" >/dev/null
docker compose start server >/dev/null

echo "▶ 6/6 検証（ローカル件数と本番件数の照合）"
Q="SELECT (SELECT count(*) FROM menu_items)||'|'||(SELECT count(*) FROM orders)||'|'||(SELECT count(*) FROM order_items)||'|'||(SELECT round(sum(base_price),2) FROM menu_items);"
sleep 4
L="$(docker compose exec -T postgres psql -U bar -d bardb -t -A -c "$Q" | tr -d '[:space:]')"
P="$(ssh -o BatchMode=yes "$PROD_SSH" "sudo docker exec bar-pos-postgres psql -U bar -d bardb -t -A -c \"$Q\"" | tr -d '[:space:]')"
echo "   local: $L"
echo "   prod : $P"
if [ "$L" = "$P" ]; then
  echo "✅ 完了: ローカルは本番データと一致しています。http://localhost/ の「売上管理」で分析できます。"
else
  echo "⚠️ 不一致です。$LOCAL_BK から復旧を検討してください。" >&2; exit 1
fi
