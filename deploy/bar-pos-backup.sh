#!/usr/bin/env bash
# bar-pos DBバックアップ: pg_dump を日次で取得し、古い世代を削除する。
# 実行結果は journald（systemd 経由）に出力される。
#
# 設計上の注意:
#   壊れたダンプが「バックアップがある」ように見える状態が最悪なので、
#   一旦 .part に書き、pg_dump の完了マーカーを確認してから正式名に rename する。
#   復旧が必要になる場面では、ファイルの存在＝復旧可能でなければならない。
set -euo pipefail

BACKUP_DIR=/opt/bar-pos-system/backups
CONTAINER=bar-pos-postgres
DB_USER=bar
DB_NAME=bardb
KEEP_DAYS=30

mkdir -p "$BACKUP_DIR"

# postgres が healthy でないときに空・不完全なダンプを掴まないようにする
status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$CONTAINER" 2>/dev/null || echo missing)"
if [ "$status" != "healthy" ]; then
  echo "[backup] $CONTAINER is '$status' -> skip"
  exit 1
fi

DEST="$BACKUP_DIR/backup_$(date +%Y%m%d_%H%M%S)_auto.sql"
TMP="${DEST}.part"

if ! docker exec "$CONTAINER" pg_dump -U "$DB_USER" "$DB_NAME" > "$TMP" 2>/dev/null; then
  echo "[backup] pg_dump FAILED"
  rm -f "$TMP"
  exit 1
fi

# pg_dump は正常終了時に末尾へ完了マーカーを書く。これが無いダンプは復元できない
if ! tail -5 "$TMP" | grep -q 'PostgreSQL database dump complete'; then
  echo "[backup] dump is incomplete -> discard"
  rm -f "$TMP"
  exit 1
fi

mv "$TMP" "$DEST"
echo "[backup] wrote $DEST ($(stat -c %s "$DEST") bytes)"

# 世代管理。手動バックアップ（*_pre_deploy.sql 等）は消さず、自動取得分のみ対象にする
pruned="$(find "$BACKUP_DIR" -maxdepth 1 -name 'backup_*_auto.sql' -type f -mtime "+$KEEP_DAYS" -print -delete | wc -l)"
echo "[backup] pruned $pruned backup(s) older than ${KEEP_DAYS} days"

# 中断で取り残された .part を掃除する
find "$BACKUP_DIR" -maxdepth 1 -name '*.part' -type f -mtime +1 -delete
