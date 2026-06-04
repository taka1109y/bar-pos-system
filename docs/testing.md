# 結合テスト手順書

## 1. テスト環境のセットアップ

### 1-1. コンテナを新規構築して起動

```bash
# ビルドとコンテナ起動（初回 or 再構築時）
docker compose up -d --build

# 起動確認
docker compose ps
```

### 1-2. テストデータを投入する

> **注意**: 既存データが**すべて削除**されます。必ず本番とは別のコンテナで実行してください。

```bash
# テスト用データを投入（全テーブルをリセット → 再投入）
docker compose exec server npm run seed:test
```

#### 投入されるデータの概要

| 種別 | 内容 |
|------|------|
| 席 | テーブル 8台 / カウンター 4台 / 即会計 1台 |
| カテゴリ | 5件（生ビール / ハイボール / カクテル / ソフトドリンク / フード）|
| サブカテゴリ | 10件 |
| メニュー商品 | 19件（ドリンク 14件 / フード 5件）|
| 材料・レシピ | 材料 4種 / レシピ 6件 / 在庫 4種 |
| テスト注文 | 6件（下表参照）|

#### テスト注文の内訳

| テーブル | status | receipt_type | 用途 |
|---------|--------|--------------|------|
| テーブル1 | `open` | `normal` | POS会計フローのテスト |
| テーブル2 | `paid` / 今日 | `normal` | 当日日計レポートのテスト |
| テーブル3 | `paid` / 昨日 | `normal` | 日付フィルタのテスト |
| テーブル4 | `paid` | `black_cancelled` | 取消し再発行テスト（元伝票）|
| テーブル4 | `paid` | `void` | 取消し再発行テスト（証跡）|
| テーブル4 | `open` | `red` | 取消し再発行テスト（赤伝票）|

> **注意**: `register_open=false` の初期状態です。ブラウザで `/start` にアクセスしてレジをオープンしてください。

---

## 2. LAN 環境からのアクセス

### 2-1. UIへのアクセス（port 80）

`docker-compose.yml` の `client.ports: "80:80"` はすべてのネットワークインターフェイスにバインドされているため、
**同一LAN内の端末から `http://[ホストのIPアドレス]/` でアクセスできます。**

ホストのIPアドレス確認方法：
```bash
# macOS
ipconfig getifaddr en0

# Windows (PowerShell)
(Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias Wi-Fi).IPAddress
```

アクセス例: `http://192.168.1.10/`

### 2-2. WebSocket（Socket.io）のLAN接続を有効にする

LAN上の別IPからアクセスするとオリジン検証によりWebSocket接続が失敗します。
`docker-compose.yml` の `server > environment` を以下のように切り替えてください：

```yaml
# ─── 本番用（デフォルト）────────────────
CLIENT_ORIGIN: http://localhost

# ─── テスト用（上の行をコメントアウトして下を有効にする）──────
# CLIENT_ORIGIN: "*"
```

切り替え後、サーバーを再起動して適用：
```bash
docker compose up -d --build --no-deps server
```

> **セキュリティ注意**: `CLIENT_ORIGIN: "*"` はすべてのオリジンからのWebSocket接続を許可します。
> テスト完了後は必ず `http://localhost` に戻してください。

---

## 3. テストデータのリセット

テストを最初からやり直す場合：

```bash
# テストデータを初期状態に戻す（推奨: サーバーを再起動しない）
docker compose exec server npm run seed:test
```

> **注意**: `seed:test` 実行後にサーバーコンテナを再起動すると、
> 起動時の `seed()` が走ってデータが上書きされます。
> テスト中はサーバーコンテナの再起動を避けてください。

ボリュームごと削除してゼロから再構築する場合：
```bash
# ※ 注意: uploads（メニュー画像）も削除されます
docker compose down -v
docker compose up -d --build
```

---

## 4. よくあるテストシナリオ

### POS会計フロー
1. ブラウザで `http://[IP]/start` → 開店準備金を入力してレジオープン
2. テーブル1（スーパードライ×2 + ナチョス×1 が注文済み）を選択
3. 追加注文 → 会計

### 日計レポートの確認
1. レジオープン後、POSページ → レジクローズ → 日計レポートを確認
2. 今日の売上にはテーブル2の注文（角ハイボール×2 + フライドポテト×1）が含まれる
3. 昨日の日付で検索するとテーブル3の注文（ジントニック×3 + コーラ×3）が出る

### 取消し再発行のテスト
1. POSページ → 伝票情報 → テーブル2の支払い済み伝票を選択
2. void-and-reissue を実行 → black_cancelled + void + red が生成されることを確認

### DBへの直接アクセス（デバッグ用）
```bash
docker compose exec postgres psql -U bar -d bardb

# テーブルの内容を確認
\dt
SELECT * FROM tables;
SELECT * FROM orders ORDER BY id;
```
