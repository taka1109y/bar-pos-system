# Sports Bar POS System

スポーツバー向けPOSシステム。**株価変動型ダイナミックプライシング**が特徴で、注文の多いドリンクほどリアルタイムで価格が上昇する。

3コンテナ構成（PostgreSQL / Node.js + Express / Nginx）を Docker Compose で起動する。Raspberry Pi 5 (Ubuntu 24.04 / ARM64) 等での常設運用を想定。

---

## 主な機能

- **ダイナミックプライシング** — 需要に応じてドリンク価格が30秒ごとに自動変動（サブカテゴリ内競合ロジック・株価暴落機能付き）
- **セルフ注文** — 客席のQRから注文（`/table/:id`）、価格ボード（`/board`）、キッチン表示（`/kitchen`）
- **レジ開閉フロー** — 開店準備金入力でオープン、日計レポート・PDF出力・金種差異確認でクローズ
- **会計** — 内税方式、標準10%/軽減8%の税率区分、深夜料金、割引、商品券、現金/カード/電子マネー
- **時価商品** — 「価格変更可」フラグ付き商品は注文時に価格・商品名を上書き可能（特別料理・未登録商品向け）
- **赤伝票** — 当日会計済み伝票の取消し・再発行（void-and-reissue）
- **在庫・原価管理** — 材料マスター・レシピ・在庫異動・原価率/粗利分析
- **リアルタイム同期** — Socket.io で価格・注文・テーブル状態を全端末に即時反映

---

## 起動方法

### 本番 (Docker / Raspberry Pi 5・Ubuntu 24.04)

初回のみ環境変数ファイルを用意する（`.env` は Git 管理外）:

```bash
cp .env.example .env
# .env を編集し POSTGRES_PASSWORD を強力なものに変更（初回起動前に必須）
```

```bash
docker compose up -d --build   # ビルドして起動
docker compose up -d           # 既存イメージで起動
docker compose logs -f server  # サーバーログ確認
docker compose down            # 停止（データは保持）
```

- アクセス: **http://localhost**（同一LANの端末からは **http://<ラズパイのIP>/**）
- ベースイメージ（node:20-alpine / postgres:16-alpine / nginx:alpine）はいずれも ARM64 対応
- `POSTGRES_PASSWORD` は**空のDBボリュームへの初回起動時のみ**適用される（後から変える場合はボリューム再作成が必要）

### 開発 (ローカル)

PostgreSQL が別途必要:

```bash
docker run --rm -d --name pg \
  -e POSTGRES_DB=bardb -e POSTGRES_USER=bar -e POSTGRES_PASSWORD=bar \
  -p 5432:5432 postgres:16-alpine
```

```bash
npm install                                                        # 依存関係インストール（npm workspaces）
DATABASE_URL=postgres://bar:bar@localhost:5432/bardb npm run dev   # サーバー + クライアント同時起動
```

- フロントエンド: http://localhost:5173 ／ バックエンドAPI: http://localhost:3001
- 自動テストは無し。動作確認は `curl` とブラウザで手動実施。

---

## 本番運用（更新・バックアップ）

### コードのアップデート反映

GitHub に push した変更を Pi に反映する手順:

```bash
cd ~/bar-pos-system
git pull
docker compose up -d --build
```

これだけで新しいソースからイメージが再ビルドされ、コンテナが作り直される。

### なぜ既存データが消えないか

| 仕組み | 内容 |
|---|---|
| **ボリューム永続化** | `pg_data`（DB）と `uploads`（画像）は `up --build` / `down`（`-v`なし）では保持される |
| **追加式マイグレーション** | server起動時に `initDb()` が `db/schema.sql` を毎回実行。中身は全て `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` / `INSERT … ON CONFLICT DO NOTHING`。既存テーブル・データは触らず、新テーブル/カラムだけ追加される |
| **シードは空DB時のみ** | `seed()` は `SELECT COUNT(*) FROM tables` で既存データがあればスキップ。実データを上書き・重複させない |

→ 通常の機能追加・カラム追加は **`git pull` + `docker compose up -d --build`** だけで、売上・メニュー・設定を保ったまま反映される。

### スキーマ変更の扱い

| 種類 | 対応 | 例 |
|---|---|---|
| ✅ 安全（自動反映） | そのまま | 新テーブル、`ADD COLUMN IF NOT EXISTS … DEFAULT`付き新カラム、新設定キー、インデックス追加 |
| ⚠️ 要注意（手動） | 慎重なマイグレーション＋バックフィルが必要 | 既存カラムのリネーム/型変更/削除、後付け `NOT NULL`（既存行が違反）、後付けユニーク制約 |

> **重要**: `schema.sql` は起動のたびに全文が再実行される。追記するマイグレーションは必ず**冪等**（何度実行しても安全）に書くこと。`DROP COLUMN` 等の破壊的文を安易に足すと更新のたびにデータが消える。

### DBバックアップ / 復元

売上データを持つため、特にスキーマ変更を含む更新の前はバックアップを推奨（`bar` は `.env` の `POSTGRES_USER`）:

```bash
# バックアップ
docker compose exec -T postgres pg_dump -U bar -d bardb > backup_$(date +%Y%m%d_%H%M).sql

# 復元
cat backup_YYYYMMDD_HHMM.sql | docker compose exec -T postgres psql -U bar -d bardb
```

### 運用上の注意

- 🚫 **`docker compose down -v` は本番で絶対に使わない** — `-v` はボリューム削除＝DB・画像が全消去
- `.env` は `.gitignore` 済みで `git pull` では消えない。将来 `.env.example` に変数が増えたら Pi の `.env` にも手動追記
- **ロールバック**: 不具合時は `git checkout <前のコミット>` → `docker compose up -d --build`（追加済みカラムは残るが無害）
- **ダウンタイム**: 再ビルド→再起動で数秒〜（Piではビルドに数分）。**閉店後の更新**を推奨
- 古い会計データは `POST /api/maintenance/archive`（デフォルト90日超）で一括削除可能

---

## 画面一覧

| URL | 対象 | 説明 |
|-----|------|------|
| `/start` | **従業員** | レジオープン前。金種入力で開店準備金を登録しレジをオープン |
| `/` | **従業員** | サイドバーナビ付き管理画面（レジオープン中のみアクセス可） |
| `/board` | **大型ディスプレイ** | 全ドリンクの現在価格をリアルタイム表示（TV投影用）。レジオープン前は時計表示 |
| `/table` | **お客さん** | テーブル選択画面 |
| `/table/:id` | **お客さん** | セルフ注文（QR配布）。商品画像付きグリッド |
| `/kitchen` | **キッチン / バー** | 注文アイテム一覧・提供ステータス管理 |

**ルートガード**: `register_open=false` のとき、`/` は `/start` へ、公開画面（board/table/kitchen）は「レジオープン前」表示になる。

### 管理画面ナビゲーション（左サイドバー・折りたたみ可能）

| グループ | メニュー | 内容 |
|---|---|---|
| **操作** | レジ画面 | テーブルグリッド（合計金額・滞在時間表示）→ 注文パネル |
| | 即会計 | チャージなしの即時会計（テイクアウト等） |
| | レジクローズ | 日次精算レポート・金種入力・PDF出力・クローズ確定 |
| **マスタ管理** | テーブル管理 | テーブル/カウンターのCRUD |
| | 商品管理 | メニューCRUD・価格帯/ステップ・画像・税率区分・従業員専用・**時価フラグ** |
| | カテゴリ管理 | カテゴリ/サブカテゴリCRUD |
| | 在庫管理 | 材料の棚卸し・仕入れ・在庫異動ログ |
| | レシピ管理 | 商品ごとの材料設定・原価自動計算 |
| **分析** | 売上管理 | 日次レポート・商品別ランキング |
| | 伝票情報 | 会計済み伝票の詳細・赤伝票発行 |
| | 原価分析 | 原価率・粗利・在庫評価 |
| **設定** | システム管理 | 消費税（標準/軽減）・深夜料金・チャージ・デフォルト税率区分・レジ設定 |

フッターリンク: 価格ボード ↗ `/board` ／ キッチン ↗ `/kitchen`

---

## アーキテクチャ

```
┌─────────────────────────────────────────────────────┐
│  client (nginx:80)  React 19 + Vite + Tailwind v4   │
│  SPA配信 + /uploads/* 静的配信                       │
└───────────┬─────────────────────────────────────────┘
            │ /api/*  +  /socket.io/  を server:3001 へproxy
┌───────────▼─────────────────────────────────────────┐
│  server (Node.js 20:3001)  Express + Socket.io      │
│  REST API + 価格エンジン（30秒ティック）             │
└───────────┬─────────────────────────────────────────┘
            │ DATABASE_URL (postgres://)
┌───────────▼─────────────────────────────────────────┐
│  postgres:16-alpine   volume: pg_data                │
└─────────────────────────────────────────────────────┘

Docker volumes:
  pg_data  — PostgreSQL データ（永続）
  uploads  — アップロード画像（server ↔ nginx で共有・永続）
```

ORM は使わず `pg` の生SQL。認証機構は無し（後述の制約参照）。

---

## 技術スタック

| 層 | 技術 |
|----|------|
| フロントエンド | React 19, Vite, Tailwind CSS v4 |
| 状態管理 | Zustand（ライブ価格）, TanStack Query v5（サーバー状態・オプティミスティック更新） |
| リアルタイム | Socket.io v4 |
| 帳票 | jsPDF + html2canvas（PDF出力）, インラインSVG（スパークライン） |
| ルーティング | React Router v7 |
| バックエンド | Node.js 20, Express v4, multer（画像アップロード）, pino（ログ） |
| DB | PostgreSQL 16（pg v8・生SQL） |
| インフラ | Docker Compose, nginx-alpine |

---

## 環境変数

`.env`（`.env.example` をコピーして作成、`docker-compose.yml` が参照）:

| 変数 | 用途 |
|------|------|
| `POSTGRES_DB` | DB名（既定 `bardb`） |
| `POSTGRES_USER` | DBユーザー（既定 `bar`） |
| `POSTGRES_PASSWORD` | DBパスワード（**本番では強力な値に**） |

`docker-compose.yml` 内で server コンテナに渡す変数:

| 変数 | 値 | 説明 |
|------|-----|------|
| `DATABASE_URL` | `postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}` | DB接続文字列 |
| `NODE_ENV` | `production` | — |
| `PORT` | `3001` | サーバーポート |
| `CLIENT_ORIGIN` | `*` | CORS/Socket.io 許可オリジン（LAN内複数端末向け） |
| `TZ` | `Asia/Tokyo` | タイムゾーン |

> DB・server の外部ポートは既定で非公開（`docker-compose.yml` でコメントアウト）。nginx（80）経由でのみアクセス。

---

## データ永続化

| ボリューム | マウント先 | 内容 |
|---|---|---|
| `pg_data` | `postgres:/var/lib/postgresql/data` | PostgreSQL データ |
| `uploads` | `server:/app/uploads` ↔ `nginx:/usr/share/nginx/html/uploads` | アップロード画像 |

`docker compose down`（`-v` なし）ではボリュームは削除されない。`-v` を付けると両方消えるため本番厳禁。

---

## データベーススキーマ（主なテーブル）

```
tables          席情報 (id, name, table_type[table|counter|immediate], status)
categories      カテゴリ (id, name, sort_order, crash_pct, is_staff_only)
subcategories   サブカテゴリ (id, category_id, name, sort_order, crash_pct)
menu_items      メニュー (id, category_id, subcategory_id, name,
                base_price, current_price, min_price, max_price,
                price_step_up, price_step_down, is_drink, is_active,
                crash_enabled, is_crashed, image_url[ファイル名],
                tax_category[standard|reduced], is_staff_only,
                price_editable[時価], cost_price, recipe_notes)
orders          注文 (id, table_id, status[open|paid], total_amount, payment_method,
                opened_at, closed_at, guest_count, discount_amount,
                tax_rate, tax_amount, late_night_rate, late_night_amount,
                memo, gift_cert_amount, gift_cert_no_change,
                charge_per_person, charge_amount,
                receipt_type[normal|black_cancelled|void|red], original_order_id)
order_items     注文明細 (id, order_id, menu_item_id, quantity, unit_price, item_name,
                status, created_at)
pricing_events  価格計算用イベント (10分でプルーン)
price_history   価格履歴 (スパークライン用・最大60件/商品)
system_settings key-value（税率・深夜料金・チャージ・レジ開閉状態など）
ingredients          材料マスター
recipes              商品⇔材料の対応（原価自動計算）
ingredient_stock     材料在庫
ingredient_stock_logs 在庫異動ログ
```

スキーマは `db/schema.sql` に集約。テーブル定義＋追加カラムのマイグレーション（`ADD COLUMN IF NOT EXISTS`）＋インデックスを含む。

**数値型の注意**: `NUMERIC` カラムは `pg` で文字列として返るため、SQLでは常に `::float` キャストする。

---

## ダイナミックプライシング仕様

1. 過去 N 秒（既定300秒）の全ドリンク注文数を集計
2. サブカテゴリ所属アイテム: 自分の需要 × `price_step_up` − 競合需要 × `price_step_down` で目標価格を算出（同一サブカテゴリ内で競合が需要を奪うと価格が下がる）
3. サブカテゴリ無し: 自分の需要 × `price_step_up`
4. 目標価格へ即時引き上げ、`PRICE_STEP_DOWN` 率で緩やかに下降
5. `min_price`〜`max_price` でクランプ → ¥25単位に丸め
6. 変化があれば `price_history` に記録し `prices:updated` をブロードキャスト

**設定パラメータ**（`GET/PATCH /api/settings/pricing`）: `TICK_INTERVAL_MS`(30000) / `WINDOW_SECONDS`(300) / `PRICE_STEP_DOWN`(0.04) / `HISTORY_KEEP`(60)。`price_step_up`/`price_step_down` は商品ごとに¥単位で個別設定。

---

## 会計・料金計算仕様（全額 税込み・内税方式）

1. 商品を税率区分で分類: `standard`（10%）と `reduced`（8%）
2. **深夜料金** = standardItemsSubtotal × `late_night_rate`（商品のみ・チャージ除く）
3. **課税対象（標準）** = standardItemsTotal + charge_amount + late_night_amount − discount_amount（最小0）
4. **割引残額** = max(0, discount − standardTotal − charge − late_night)
5. **課税対象（軽減）** = max(0, reducedItemsTotal − 割引残額)
6. **消費税（表示用）** = `round(課税標準 × 0.10/1.10)` + `round(課税軽減 × 0.08/1.08)`
7. **合計** = 課税標準 + 課税軽減
8. **商品券** = 現金決済額から差引（`gift_cert_no_change=true` なら合計を上限にキャップ）

**深夜時間帯**: 32時間制（例: 22〜29 = 22:00〜翌5:00）。サーバー側は JST で判定。
**チャージ**: 注文作成時（人数選択時）に `system_settings` の設定を解決して確定。以後は再計算しない。
**時価商品**: `price_editable=true` の商品のみ、注文追加時に `unit_price`/`item_name` の上書きを受け付ける（サーバー側でフラグを検証）。

---

## Socket.io イベント

| 方向 | イベント | 用途 |
|------|---------|------|
| S→C | `prices:updated` | 価格変動通知（全クライアント） |
| S→C | `prices:sync` | 接続時の価格フル同期 |
| S→C | `order:updated` | 注文変更通知（`{tableId, orderId, items, total, chargeAmount, chargePerPerson, guestCount}`・テーブルルーム） |
| S→C | `table:status_changed` | テーブルステータス変更通知 |
| C→S | `client:subscribe_table` / `client:unsubscribe_table` | テーブルルーム参加/退出 |

---

## API エンドポイント（抜粋）

すべて `/api` 配下。エラー形式は共通で `{ "error": "<message>" }`。

| 分類 | 主なエンドポイント |
|---|---|
| Tables | `GET/POST /tables`, `PATCH/DELETE /tables/:id`, `GET /tables/immediate` |
| Menu | `GET /menu`(客用・staff除外), `GET /menu?staff=true`(POS用), `GET /menu/all`, `POST /menu`, `PATCH/DELETE /menu/:id`, `POST /menu/crash`・`/menu/crash/reset` |
| Uploads | `POST /uploads/menu-images`（multipart, field `image` → `{ filename }`） |
| Orders | `GET /orders/open`, `GET /orders/table/:tableId`, `POST /orders`, `POST /orders/:id/items`(時価は`unit_price`/`item_name`可), `PATCH/DELETE /orders/:id/items/:itemId` |
| Payments | `POST /payments/:orderId` |
| Prices | `GET /prices`, `GET /prices/:id/history` |
| Reports | `GET /reports/daily?date=YYYY-MM-DD&since=ISO` |
| Receipts | `GET /receipts?date=YYYY-MM-DD`, `POST /receipts/:orderId/void-and-reissue`（赤伝票） |
| System | `GET/PATCH /system/settings`（税率・深夜・チャージ・`register_open` 等） |
| Settings | `GET/PATCH /settings/pricing`, `POST /settings/pricing/reset` |
| Kitchen | `GET /kitchen/orders`, `PATCH /kitchen/items/:itemId/serve` |
| Logs | `GET /logs`（from/to/receipt_type/payment_method/limit/offset） |
| Maintenance | `POST /maintenance/archive`（古いデータ一括削除） |
| Ingredients | `GET/POST /ingredients`, `PATCH/DELETE /ingredients/:id` |
| Inventory | `POST /inventory/:id/init`・`/inventory/adjust`・`/inventory/purchase`, `GET /inventory/logs` |
| Recipes | `GET /recipes`, `GET /recipes/menu/:menuItemId`, `PUT /recipes/menu/:menuItemId` |

詳細な仕様・制約は `CLAUDE.md` を参照。

---

## 既知の制約

| 優先度 | 内容 |
|---|---|
| 高 | **API 認証なし** — 全エンドポイントが認証なしでアクセス可能。**LAN内限定運用が前提**。外部公開・不特定Wi-Fi環境では別途認証が必要 |
| 中 | フロントエンド JS バンドル未分割 |
| 低 | React エラーバウンダリなし |
| 低 | `price_history` は初回起動直後は空（価格変動が起きるまでスパークラインは水平線） |
