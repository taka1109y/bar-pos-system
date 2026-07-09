# deploy/ — 本番ホスト（Raspberry Pi）向けインフラ資材

`docker-compose.yml` に含められない**ホスト側の設定**をここに集約する。zip 再デプロイでも消えないよう、これらは Pi のホストに直接インストールする。

## 内容

| ファイル | 配置先 | 役割 |
|---|---|---|
| `daemon.json` | `/etc/docker/daemon.json` | Docker ログの既定ローテーション（json-file 10MB×3）。compose 外・将来のコンテナにも適用される保険 |
| `bar-pos-healwatch.sh` | `/usr/local/bin/bar-pos-healwatch.sh` | `unhealthy` なコンテナを検知して `docker restart`（ハング復旧） |
| `bar-pos-healwatch.service` | `/etc/systemd/system/` | 上記スクリプトを実行する oneshot ユニット |
| `bar-pos-healwatch.timer` | `/etc/systemd/system/` | 毎分ウォッチドッグを起動するタイマー |

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
```

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
```
