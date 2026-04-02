# Sports Bar POS System

スポーツバー向けPOSシステム。**株価変動型ダイナミックプライシング**が特徴で、注文の多いドリンクほどリアルタイムで価格が上昇する。

---

## 起動方法

### 本番 (Docker)

```bash
docker compose up -d --build  # ビルドして起動
docker compose up -d          # 既存イメージで起動
docker compose down           # 停止
docker compose down -v        # 停止 + DBデータ削除
```

アクセス: **http://localhost**

### 開発 (ローカル)

PostgreSQL が別途必要:

```bash
docker run --rm -d --name pg \
  -e POSTGRES_DB=bardb -e POSTGRES_USER=bar -e POSTGRES_PASSWORD=bar \
  -p 5432:5432 postgres:16-alpine
```

```bash
npm install                                                         # 依存関係インストール
DATABASE_URL=postgres://bar:bar@localhost:5432/bardb npm run dev   # サーバー + クライアント同時起動
```

- フロントエンド: http://localhost:5173
- バックエンドAPI: http://localhost:3001

---

## 画面一覧

| URL | 対象 | 説明 |
|-----|------|------|
| `http://localhost/` | **従業員** | サイドバーナビ付き管理画面。レジ・各種管理・売上・伝票・システム設定を切り替え |
| `http://localhost/board` | **大型ディスプレイ** | 全ドリンクの現在価格をスパークライン付きで表示（TV投影用） |
| `http://localhost/table/:id` | **お客さん** | セルフ注文・注文確認モーダル（QRコードで配布） |
| `http://localhost/kitchen` | **キッチン / バー** | 注文アイテム一覧・ステータス管理（提供完了 / キャンセル） |

### 管理画面のナビゲーション

左サイドバーから各機能に切り替える（インライン表示、管理系はポップアップモーダル）:

| メニュー | 内容 |
|---|---|
| レジ画面 | テーブルグリッド表示。使用中テーブルは合計金額と滞在時間(hh:mm)を表示。テーブル選択で注文パネルを開く |
| テーブル管理 | テーブル / カウンターのCRUD（タイプ別に色分け表示） |
| 商品管理 | メニューCRUD・カテゴリ/サブカテゴリ別一覧・価格帯・価格ステップ設定 |
| カテゴリ管理 | カテゴリ / サブカテゴリのCRUD |
| 価格設定 | 価格エンジンのパラメータをUIから変更 |
| 売上管理 | 日次レポート・商品別ランキング |
| 伝票情報 | 会計済み伝票の詳細一覧（日付フィルター・明細展開） |
| システム管理 | 消費税率・深夜料金（料率・時間帯）の設定 |
| 価格ボード ↗ | `/board` を別タブで開く |
| キッチン ↗ | `/kitchen` を別タブで開く |

---

## アーキテクチャ

```
┌─────────────────────────────────────────────────────┐
│  ブラウザ (client - nginx:80)                        │
│  React 19 + Vite 8 + Tailwind CSS v4                │
│  ├── /           従業員管理画面 (サイドバーナビ)      │
│  ├── /board      価格ボード（TV）                    │
│  ├── /table/:id  お客さん注文ページ                  │
│  └── /kitchen    キッチン表示                        │
└────────────────────┬────────────────────────────────┘
                     │ HTTP /api/*  +  WebSocket /socket.io/
┌────────────────────▼────────────────────────────────┐
│  バックエンド (server - Node.js 20:3001)             │
│  Express v4 + Socket.io v4                          │
│  ├── REST API (tables, menu, orders, payments,      │
│  │            prices, reports, receipts,            │
│  │            system, settings, kitchen)            │
│  └── 価格エンジン (30秒ごとに価格を自動更新)          │
└────────────────────┬────────────────────────────────┘
                     │ DATABASE_URL (postgres://)
┌────────────────────▼────────────────────────────────┐
│  DB (postgres:16-alpine)                            │
│  ボリューム: pg_data (永続化)                        │
└─────────────────────────────────────────────────────┘
```

---

## ディレクトリ構成

```
bar-pos-system/
├── docker-compose.yml          # 3コンテナ定義 (postgres + server + client)
├── package.json                # npm workspaces ルート
│
├── server/
│   ├── Dockerfile
│   ├── index.js                # エントリーポイント・Socket.io・404ハンドラー
│   ├── db/
│   │   ├── database.js         # pg.Pool + query() ヘルパー + initDb()
│   │   ├── schema.sql          # PostgreSQL DDL (9テーブル + インデックス)
│   │   └── seed.js             # 初期データ
│   ├── routes/
│   │   ├── tables.js           # GET/POST/PATCH/DELETE /api/tables
│   │   ├── menu.js             # GET/POST/PATCH/DELETE /api/menu
│   │   ├── orders.js           # GET/POST/PATCH/DELETE /api/orders
│   │   ├── payments.js         # POST /api/payments/:orderId
│   │   ├── prices.js           # GET /api/prices  GET /api/prices/:id/history
│   │   ├── reports.js          # GET /api/reports/daily|items
│   │   ├── receipts.js         # GET /api/receipts?date=YYYY-MM-DD
│   │   ├── system.js           # GET/PATCH /api/system/settings
│   │   ├── settings.js         # GET/PATCH /api/settings/pricing
│   │   └── kitchen.js          # GET/PATCH /api/kitchen
│   └── services/
│       ├── pricingEngine.js    # ダイナミック価格エンジン (30秒ティック)
│       ├── pricingSettings.js  # 価格エンジンのランタイム設定
│       └── socketService.js    # Socket.io io インスタンス共有
│
└── client/
    ├── Dockerfile              # multi-stage: node build → nginx serve
    ├── nginx.conf              # /api/ + /socket.io/ をserverへproxy
    ├── vite.config.js          # 開発時プロキシ設定
    └── src/
        ├── App.jsx             # BrowserRouter + QueryClientProvider
        ├── api.js              # fetch ベースのAPIクライアント
        ├── socket.js           # Socket.io クライアントシングルトン
        ├── index.css           # Tailwind + アニメーション
        ├── store/
        │   └── usePriceStore.js  # Zustand: ライブ価格状態 (flash方向付き)
        ├── pages/
        │   ├── POSPage.jsx       # 従業員管理画面 (サイドバーレイアウト)
        │   ├── BoardPage.jsx     # TV価格ボード
        │   ├── TablePage.jsx     # お客さん注文画面
        │   ├── KitchenPage.jsx   # キッチン表示
        │   ├── ReportsPage.jsx   # 売上レポート
        │   ├── ReceiptsPage.jsx  # 伝票情報
        │   └── SystemSettingsPage.jsx  # システム設定
        └── components/
            ├── layout/TickerBar.jsx      # 横スクロール価格ティッカー
            ├── pos/TableGrid.jsx         # テーブルグリッド (金額・滞在時間表示)
            ├── pos/OrderPanel.jsx        # 注文サイドパネル
            ├── pos/MenuGrid.jsx          # カテゴリタブ + メニュー選択
            ├── pos/PaymentModal.jsx      # 会計モーダル (割引・深夜料金・消費税)
            ├── board/PriceCard.jsx       # 価格カード (スパークライン付き)
            ├── board/Sparkline.jsx       # Recharts ラッパー
            ├── tables/TableManager.jsx   # テーブル/カウンターCRUD
            ├── menu/MenuManager.jsx      # メニューCRUD
            └── menu/CategoryManager.jsx  # カテゴリ/サブカテゴリCRUD
```

---

## 技術スタック

| 層 | 技術 |
|----|------|
| フロントエンド | React 19, Vite 8, Tailwind CSS v4 |
| 状態管理 | Zustand (ライブ価格), TanStack Query v5 (サーバー状態・オプティミスティック更新) |
| リアルタイム | Socket.io v4 (setQueryData による即時キャッシュ更新) |
| グラフ | Recharts |
| ルーティング | React Router v7 |
| バックエンド | Node.js 20, Express v4 |
| DB | PostgreSQL 16 (pg v8) |
| インフラ | Docker Compose, nginx-alpine |

---

## データベーススキーマ

```
tables          テーブル席情報 (id, name, table_type[table|counter], capacity, status)
categories      メニューカテゴリ (id, name, sort_order)
subcategories   サブカテゴリ (id, category_id, name, sort_order)
menu_items      メニュー (id, category_id, subcategory_id, name, base_price, current_price,
                         min_price, max_price, price_step_up, price_step_down, is_drink, is_active)
orders          注文 (id, table_id, status[open|paid], total_amount, payment_method,
                     opened_at, closed_at, discount_amount, tax_rate, tax_amount,
                     late_night_rate, late_night_amount)
order_items     注文明細 (id, order_id, menu_item_id, quantity, unit_price, item_name, status)
pricing_events  価格計算用イベントログ (id, menu_item_id, quantity, event_time)
price_history   価格履歴 (id, menu_item_id, price, recorded_at) ← スパークライン用
system_settings システム設定 key-value (tax_rate, late_night_rate, late_night_start, late_night_end)
```

---

## ダイナミックプライシング仕様

**価格変動ロジック**:
1. 過去 N 分 (デフォルト5分) の全ドリンク注文数を 1 クエリで集計
2. サブカテゴリに属するアイテム: 自分の需要 × `price_step_up` (¥) − 競合需要 × `price_step_down` (¥) で目標価格を計算。同じサブカテゴリ内で競合するドリンクが需要を奪うと価格が下がる
3. サブカテゴリなし: 自分の需要 × `price_step_up` のみ
4. 目標価格へ即時引き上げ、`PRICE_STEP_DOWN` 率で緩やかに下降
5. `min_price`〜`max_price` でクランプ → ¥25 単位に丸め
6. 変化があれば `price_history` に記録 + `prices:updated` ブロードキャスト

**設定可能パラメータ** (`GET/PATCH /api/settings/pricing`):

| パラメータ | デフォルト | 説明 |
|---|---|---|
| `TICK_INTERVAL_MS` | 30,000 | ティック間隔 (ms) |
| `WINDOW_SECONDS` | 300 | 需要計測ウィンドウ (秒) |
| `PRICE_STEP_DOWN` | 0.04 | 下落率 (ティック毎) |
| `HISTORY_KEEP` | 60 | 保持する価格履歴件数 |

`price_step_up` / `price_step_down` はメニューアイテムごとに個別設定 (¥単位)。

---

## 会計・料金計算仕様

会計時の計算順序:

1. **小計** (税抜き) = 注文アイテムの合計
2. **深夜料金** = 小計 × `late_night_rate` (現在時刻が設定時間帯内の場合のみ)
3. **割引** = 値引き額または割引率で指定
4. **課税対象** = 小計 + 深夜料金 − 割引
5. **消費税** = 課税対象 × `tax_rate`
6. **合計** = 課税対象 + 消費税

**深夜時間帯**: 32時間制で指定 (例: 22〜29 = 22:00〜翌5:00)。サーバー側は JST で判定。

**設定変更**: システム管理画面 または `PATCH /api/system/settings` で即時反映。

---

## Socket.io イベント仕様

| 方向 | イベント | ペイロード | 用途 |
|------|---------|-----------|------|
| Server→Client | `prices:updated` | `{ items: [{id, name, current_price, base_price, pct_change, direction}], timestamp }` | 価格変動通知 (全クライアント) |
| Server→Client | `order:updated` | `{ tableId, orderId, items, total }` | 注文変更通知 (テーブルルーム) |
| Server→Client | `table:status_changed` | `{ tableId, status }` | テーブルステータス変更通知 |
| Client→Server | `client:subscribe_table` | `{ tableId }` | テーブルルーム参加 |
| Client→Server | `client:unsubscribe_table` | `{ tableId }` | テーブルルーム退出 |

---

## APIエンドポイント

### Tables

| Method | Path | 説明 |
|--------|------|------|
| GET | `/api/tables` | 全テーブル取得 |
| POST | `/api/tables` | テーブル作成 `{ name, table_type }` |
| PATCH | `/api/tables/:id` | テーブル更新 |
| DELETE | `/api/tables/:id` | テーブル削除 (オープン注文があれば **409**) |

### Menu

| Method | Path | 説明 |
|--------|------|------|
| GET | `/api/menu` | アクティブメニュー一覧 |
| GET | `/api/menu/all` | 全メニュー (非アクティブ含む) |
| GET | `/api/menu/categories` | カテゴリ一覧 |
| POST | `/api/menu` | メニュー作成 |
| PATCH | `/api/menu/:id` | メニュー更新 |
| DELETE | `/api/menu/:id` | メニュー削除 (soft delete) |
| POST | `/api/menu/categories` | カテゴリ作成 |

### Orders

| Method | Path | 説明 |
|--------|------|------|
| GET | `/api/orders/open` | 全オープン注文一覧 (table_id, total_amount, opened_at) |
| GET | `/api/orders/table/:tableId` | テーブルの現在注文 |
| POST | `/api/orders` | 注文開始 `{ table_id }` |
| POST | `/api/orders/:id/items` | アイテム追加 |
| PATCH | `/api/orders/:id/items/:itemId` | 数量変更 |
| DELETE | `/api/orders/:id/items/:itemId` | アイテム削除 |

### Payments / Prices / Reports / Receipts

| Method | Path | 説明 |
|--------|------|------|
| POST | `/api/payments/:orderId` | 支払い完了 (割引額を body で受け取る) |
| GET | `/api/prices` | 全ドリンク現在価格 + 変動率 |
| GET | `/api/prices/:id/history` | 価格履歴 (スパークライン用) |
| GET | `/api/reports/daily?date=` | 日次売上集計 |
| GET | `/api/reports/items?start=&end=` | 商品別売上 |
| GET | `/api/receipts?date=YYYY-MM-DD` | 会計済み伝票一覧 (明細・料金内訳付き) |

### System / Settings / Kitchen

| Method | Path | 説明 |
|--------|------|------|
| GET | `/api/system/settings` | 消費税・深夜料金設定取得 |
| PATCH | `/api/system/settings` | 消費税・深夜料金設定更新 |
| GET | `/api/settings/pricing` | 価格エンジンパラメータ取得 |
| PATCH | `/api/settings/pricing` | 価格エンジンパラメータ更新 |
| POST | `/api/settings/pricing/reset` | 価格エンジンパラメータをデフォルトに戻す |
| GET | `/api/kitchen` | キッチン用注文アイテム一覧 |
| PATCH | `/api/kitchen/items/:itemId` | アイテムステータス更新 |

**エラーレスポンス共通形式**: `{ "error": "<message>" }`

---

## 環境変数

| 変数 | デフォルト | 説明 |
|------|-----------|------|
| `DATABASE_URL` | `postgres://bar:bar@localhost:5432/bardb` | PostgreSQL接続文字列 |
| `PORT` | `3001` | サーバーポート |
| `NODE_ENV` | — | `production` 時は静的配信ルートが有効 |
| `TZ_REPORT` | `Asia/Tokyo` | 深夜料金判定のタイムゾーン |

---

## 初期データ

シード (`server/db/seed.js`) により以下が自動投入される（DBが空の場合のみ）:

**テーブル席**: テーブル1〜8 + カウンター1〜4 = 計12席

**ドリンクメニュー (14品)**:
- 生ビール: スーパードライ(¥600)、プレモル(¥700)、ハートランド(¥650)
- ハイボール: ジャックコーク(¥700)、角ハイボール(¥650)、レモンサワー(¥600)、ジントニック(¥750)
- カクテル: カシスオレンジ(¥700)、モヒート(¥800)、マルガリータ(¥850)、ロングアイランドティー(¥900)
- ソフトドリンク: コーラ(¥400)、ウーロン茶(¥350)、ジュース(¥400)

**フードメニュー (5品)**: フライドポテト(¥500)、ナチョス(¥700)、ピザM(¥1,200)、チキンウィングス(¥800)、チーズバーガー(¥1,000)

**システム設定デフォルト値**: 消費税 10%、深夜料金 10%、深夜時間帯 22:00〜翌5:00 (22〜29)

---

## 既知の課題

| 優先度 | 内容 |
|---|---|
| 高 | API 認証なし — 全エンドポイントが認証なしでアクセス可能 |
| 中 | フロントエンド JS バンドル未分割 |
| 低 | React エラーバウンダリなし |
| 低 | `price_history` は初回起動直後は空 (価格変動が発生するまで記録なし) |

---

## 今後の拡張アイデア

- [x] 会計方法の選択 (現金 / カード / 電子マネー)
- [x] 価格エンジンのパラメータをUIから変更できる管理画面
- [x] キッチン/バーカウンター向け注文ディスプレイ (`/kitchen`)
- [x] 消費税・深夜料金の設定と会計への自動適用
- [x] テーブル / カウンター管理画面
- [x] 伝票情報ページ（会計済み伝票の明細閲覧）
- [ ] React Router の `lazy()` によるコード分割
- [ ] `.env` ファイルによる環境変数管理
