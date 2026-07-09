#!/usr/bin/env bash
# bar-pos ヘルスウォッチ: unhealthy なコンテナを自動再起動する。
# Docker の restart ポリシーは「プロセス落ち」しか復旧しないため、
# healthcheck が unhealthy を報告したコンテナ（ハング等）をここで再起動する。
# 実行結果は journald（systemd 経由）に出力される。
set -euo pipefail

CONTAINERS=(bar-pos-postgres bar-pos-server bar-pos-client)

for c in "${CONTAINERS[@]}"; do
  # コンテナが存在しない場合はスキップ
  if ! docker inspect "$c" >/dev/null 2>&1; then
    continue
  fi
  status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$c" 2>/dev/null || echo unknown)"
  if [ "$status" = "unhealthy" ]; then
    echo "[healwatch] $c is unhealthy -> restarting"
    if docker restart "$c" >/dev/null 2>&1; then
      echo "[healwatch] $c restarted successfully"
    else
      echo "[healwatch] $c restart FAILED"
    fi
  fi
done
