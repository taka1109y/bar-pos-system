# deploy/ — 本番ホスト（Raspberry Pi）向けインフラ資材

`docker-compose.yml` に含められない**ホスト側の設定**をここに集約する。zip 再デプロイでも消えないよう、これらは Pi のホストに直接インストールする。

## 内容

| ファイル | 配置先 | 役割 |
|---|---|---|
| `daemon.json` | `/etc/docker/daemon.json` | Docker ログの既定ローテーション（json-file 10MB×3）。compose 外・将来のコンテナにも適用される保険 |
| `bar-pos-healwatch.sh` | `/usr/local/bin/bar-pos-healwatch.sh` | `unhealthy` なコンテナを検知して `docker restart`（ハング復旧） |
| `bar-pos-healwatch.service` | `/etc/systemd/system/` | 上記スクリプトを実行する oneshot ユニット |
| `bar-pos-healwatch.timer` | `/etc/systemd/system/` | 毎分ウォッチドッグを起動するタイマー |
| `bar-pos-backup.sh` | `/usr/local/bin/bar-pos-backup.sh` | `pg_dump` を `backups/` に取得し、30日より古い自動分を削除 |
| `bar-pos-backup.service` | `/etc/systemd/system/` | 上記スクリプトを実行する oneshot ユニット |
| `bar-pos-backup.timer` | `/etc/systemd/system/` | 毎日 06:00（営業終了後）にバックアップを起動するタイマー |

> ハング復旧に `docker.sock` をコンテナへ公開する autoheal コンテナ方式は採らず、ホストの systemd で完結させている（セキュリティ方針）。

## インストール手順（Pi 上、root）

```bash
cd /opt/bar-pos-system

# 1) Docker ログローテーション
sudo cp deploy/daemon.json /etc/docker/daemon.json
sudo systemctl restart docker          # 全コンテナ再起動（短時間ダウン）

# 2) compose の logging / healthcheck 反映（最新ソース取得後）
sudo docker compose up -d              # 変更があれば再作成

# 3) ヘルスウォッチ（ハング自動復旧）
sudo install -m 0755 deploy/bar-pos-healwatch.sh /usr/local/bin/bar-pos-healwatch.sh
sudo cp deploy/bar-pos-healwatch.service /etc/systemd/system/
sudo cp deploy/bar-pos-healwatch.timer   /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now bar-pos-healwatch.timer

# 4) DBバックアップ（毎日 06:00・30日保持）
sudo install -m 0755 deploy/bar-pos-backup.sh /usr/local/bin/bar-pos-backup.sh
sudo cp deploy/bar-pos-backup.service /etc/systemd/system/
sudo cp deploy/bar-pos-backup.timer   /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now bar-pos-backup.timer
```

## バックアップの限界（把握しておくこと）

- **同一ディスク上にしか置いていない。** ストレージ故障には無力なので、
  売上が積み上がったら外部（NAS・クラウド・USB）への複製を別途用意すること。
- 取得は**日次**。障害時は最大1営業日分の会計が失われる。
- `POST /api/maintenance/archive` は認証なしで会計データを物理削除できる。
  誤操作した場合の復旧は前夜のダンプまでしか戻せない。

## 確認コマンド

```bash
# ログローテーション設定
docker inspect --format '{{.HostConfig.LogConfig}}' bar-pos-server

# ヘルス状態
for c in bar-pos-postgres bar-pos-server bar-pos-client; do \
  echo "$c: $(docker inspect --format '{{.State.Health.Status}}' $c)"; done

# タイマー稼働
systemctl status bar-pos-healwatch.timer
journalctl -u bar-pos-healwatch.service --no-pager | tail

# ハング復旧テスト（server を一時停止 → 数分で自動再起動されること）
docker pause bar-pos-server

# バックアップの稼働と次回実行時刻
systemctl list-timers bar-pos-backup.timer --no-pager
journalctl -u bar-pos-backup.service --no-pager | tail

# バックアップを手動で1回走らせて確認（タイマーを待たずにテストできる）
sudo systemctl start bar-pos-backup.service
ls -lt /opt/bar-pos-system/backups | head

# 復元手順（例: 直近の自動バックアップから戻す）
# ※ 現在のデータは失われる。実行前に必ず現状のダンプを取ること
# cat /opt/bar-pos-system/backups/backup_YYYYMMDD_HHMMSS_auto.sql \
#   | docker exec -i bar-pos-postgres psql -U bar -d bardb
```
