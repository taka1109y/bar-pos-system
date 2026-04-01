# Sports Bar POS System

スポーツバー向けPOSシステム。**株価変動型ダイナミックプライシング**が特徴で、注文の多いドリンクほどリアルタイムで価格が上昇する。

---

## 起動方法

### 本番 (Docker)

```bash
docker compose up          # 起動（初回はイメージビルドあり）
docker compose up -d       # バックグラウンド起動
docker compose down        # 停止
docker compose down -v     # 停止 + DBデータ削除
docker compose build       # イメージ再ビルド
```

アクセス: **http://localhost**

### 開発 (ローカル)

PostgreSQL が別途必要（例: `docker run --rm -d --name pg -e POSTGRES_DB=bardb -e POSTGRES_USER=bar -e POSTGRES_PASSWORD=bar -p 5432:5432 postgres:16-alpine`）

```bash
npm install                     # 依存関係インストール (ルートで実行)
DATABASE_URL=postgres://bar:bar@localhost:5432/bardb npm run dev
```

- フロントエンド: http://localhost:5173
- バックエンドAPI: http://localhost:3001

---

## 画面一覧

| URL | 対象 | 説明 |
|-----|------|------|
| `http://localhost/` | **従業員** | テーブル管理・注文・会計・メニュー管理・売上レポート |
| `http://localhost/board` | **大型ディスプレイ** | 全ドリンクの現在価格をスパークライン付きで表示（TV投影用） |
| `http://localhost/table/:id` | **お客さん** | セルフ注文・現在注文確認・スタッフ呼び出し（QRコードで配布） |

### お客さん用QRコード

各テーブルに `http://<ホスト>/table/<テーブルID>` のQRコードを置く。  
例: テーブル3 → `http://localhost/table/3`

---

## アーキテクチャ

```
┌─────────────────────────────────────────────────────┐
│  ブラウザ (client - nginx:80)                        │
│  React 18 + Vite + Tailwind CSS                     │
│  ├── /           従業員POSページ                     │
│  ├── /board      価格ボード（TV）                    │
│  └── /table/:id  お客さん注文ページ                  │
└────────────────────┬────────────────────────────────┘
                     │ HTTP /api/*  +  WebSocket /socket.io/
┌────────────────────▼────────────────────────────────┐
│  バックエンド (server - Node.js:3001)                │
│  Express + Socket.io                                │
│  ├── REST API (tables, menu, orders, payments,      │
│  │            reports, prices)                      │
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
│   ├── index.js                # エントリーポイント (async main)
│   ├── db/
│   │   ├── database.js         # pg.Pool + query() ヘルパー + initDb()
│   │   ├── schema.sql          # PostgreSQL DDL
│   │   └── seed.js             # 初期データ (テーブル12席 + メニュー19品)
│   ├── routes/
│   │   ├── tables.js           # GET/POST/PATCH/DELETE /api/tables
│   │   ├── menu.js             # GET/POST/PATCH/DELETE /api/menu
│   │   ├── orders.js           # GET/POST/PATCH/DELETE /api/orders
│   │   ├── payments.js         # POST /api/payments/:orderId
│   │   ├── reports.js          # GET /api/reports/daily|items|hourly
│   │   └── prices.js           # GET /api/prices  GET /api/prices/:id/history
│   └── services/
│       ├── pricingEngine.js    # ★ダイナミック価格エンジン (30秒ティック)
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
        ├── store/
        │   └── usePriceStore.js  # Zustand: ライブ価格状態
        ├── pages/
        │   ├── POSPage.jsx       # 従業員メイン画面
        │   ├── BoardPage.jsx     # TV価格ボード
        │   ├── TablePage.jsx     # お客さん注文画面
        │   └── ReportsPage.jsx   # 売上レポート (モーダル)
        └── components/
            ├── layout/TickerBar.jsx      # 横スクロール株価ティッカー
            ├── pos/TableGrid.jsx         # テーブルグリッド (コールバッジあり)
            ├── pos/OrderPanel.jsx        # 注文サイドパネル
            ├── pos/MenuGrid.jsx          # カテゴリタブ + メニュー選択
            ├── pos/PaymentModal.jsx      # 会計確認モーダル
            ├── board/PriceCard.jsx       # 価格カード (スパークライン付き)
            ├── board/Sparkline.jsx       # Recharts ラッパー
            └── menu/MenuManager.jsx      # メニューCRUDモーダル
```

---

## 技術スタック

| 層 | 技術 |
|----|------|
| フロントエンド | React 18, Vite, Tailwind CSS v4 |
| 状態管理 | Zustand (ライブ価格), TanStack Query v5 (サーバー状態) |
| リアルタイム | Socket.io v4 |
| グラフ | Recharts |
| ルーティング | React Router v7 |
| バックエンド | Node.js, Express v4 |
| DB | PostgreSQL 16 (pg v8) |
| インフラ | Docker Compose, nginx |

---

## データベーススキーマ

```
tables          テーブル席情報 (id, name, capacity, status)
categories      メニューカテゴリ (id, name, sort_order)
menu_items      メニュー (id, category_id, name, base_price, current_price, min_price, max_price, is_drink, is_active)
orders          注文 (id, table_id, status[open|paid], total_amount, opened_at, closed_at)
order_items     注文明細 (id, order_id, menu_item_id, quantity, unit_price, item_name)
pricing_events  価格計算用イベントログ (id, menu_item_id, quantity, event_time)
price_history   価格履歴 (id, menu_item_id, price, recorded_at) ← スパークライン用
```

---

## ダイナミックプライシング仕様

**設定値** (`server/services/pricingEngine.js`):

| 定数 | 値 | 説明 |
|------|-----|------|
| `TICK_INTERVAL_MS` | 30,000 | ティック間隔 (30秒) |
| `WINDOW_SECONDS` | 300 | 需要計測ウィンドウ (5分) |
| `SURGE_THRESHOLD` | 5 | サージ開始の注文数 (5注文/5分) |
| `PRICE_STEP_UP` | 0.08 | 上昇ステップ (8%/ティック) |
| `PRICE_STEP_DOWN` | 0.04 | 下落ステップ (4%/ティック、非対称) |

**価格変動ロジック**:
1. 過去5分の注文数を集計 → `demand = 注文数 / 5`
2. `demand ≥ 1.0` → 目標価格を基準価格〜上限価格の間で比例計算
3. 目標価格に向けて1ティックあたり最大8%上昇 / 4%下落
4. `min_price`〜`max_price` でクランプ → 25円単位に丸め
5. 変化があれば `price_history` に記録 + Socket.io `prices:updated` をブロードキャスト

---

## Socket.io イベント仕様

| 方向 | イベント | ペイロード | 用途 |
|------|---------|-----------|------|
| Server→Client | `prices:updated` | `{ items: [{id, name, current_price, base_price, pct_change, direction}], timestamp }` | 価格変動通知 (全クライアント) |
| Server→Client | `order:updated` | `{ tableId, orderId, items, total }` | 注文変更通知 (テーブルルーム) |
| Server→Client | `table:status_changed` | `{ tableId, status }` | テーブルステータス変更通知 |
| Server→Client | `staff:called` | `{ tableId }` | スタッフ呼び出し通知 (全クライアント) |
| Client→Server | `client:subscribe_table` | `{ tableId }` | テーブルルーム参加 |
| Client→Server | `client:unsubscribe_table` | `{ tableId }` | テーブルルーム退出 |
| Client→Server | `customer:call_staff` | `{ tableId }` | スタッフ呼び出し (お客さん→従業員) |

---

## APIエンドポイント

### Tables
| Method | Path | 説明 |
|--------|------|------|
| GET | `/api/tables` | 全テーブル取得 |
| POST | `/api/tables` | テーブル作成 `{ name, capacity }` |
| PATCH | `/api/tables/:id` | テーブル更新 `{ name?, capacity?, status? }` |
| DELETE | `/api/tables/:id` | テーブル削除 |

### Menu
| Method | Path | 説明 |
|--------|------|------|
| GET | `/api/menu` | アクティブメニュー一覧 (カテゴリ情報付き) |
| GET | `/api/menu/all` | 全メニュー (非アクティブ含む) |
| GET | `/api/menu/categories` | カテゴリ一覧 |
| POST | `/api/menu` | メニュー作成 |
| PATCH | `/api/menu/:id` | メニュー更新 |
| DELETE | `/api/menu/:id` | メニュー削除 (soft delete) |
| POST | `/api/menu/categories` | カテゴリ作成 |

### Orders
| Method | Path | 説明 |
|--------|------|------|
| GET | `/api/orders/table/:tableId` | テーブルの現在注文 (openのみ) |
| POST | `/api/orders` | 注文開始 `{ table_id }` |
| POST | `/api/orders/:id/items` | アイテム追加 `{ menu_item_id, quantity }` |
| PATCH | `/api/orders/:id/items/:itemId` | 数量変更 `{ quantity }` (0で削除) |
| DELETE | `/api/orders/:id/items/:itemId` | アイテム削除 |

### Payments / Prices / Reports
| Method | Path | 説明 |
|--------|------|------|
| POST | `/api/payments/:orderId` | 支払い完了 → テーブルをavailableに |
| GET | `/api/prices` | 全ドリンク現在価格 + 変動率 |
| GET | `/api/prices/:id/history?limit=N` | 価格履歴 (スパークライン用) |
| GET | `/api/reports/daily?date=YYYY-MM-DD` | 日次売上 |
| GET | `/api/reports/items?start=&end=` | 商品別売上 |
| GET | `/api/reports/hourly?date=YYYY-MM-DD` | 時間別売上 |

---

## 環境変数

### server

| 変数 | デフォルト | 説明 |
|------|-----------|------|
| `DATABASE_URL` | `postgres://bar:bar@localhost:5432/bardb` | PostgreSQL接続文字列 |
| `PORT` | `3001` | サーバーポート |
| `CLIENT_ORIGIN` | (なし) | 追加許可するCORSオリジン |
| `TZ_REPORT` | `Asia/Tokyo` | レポートの時間帯タイムゾーン |

---

## 初期データ

シード (`server/db/seed.js`) により以下が自動投入される（DBが空の場合のみ）:

**テーブル席**: テーブル1〜8 (4席) + カウンター1〜4 (1席) = 計12席

**ドリンクメニュー (14品)**:
- 生ビール: スーパードライ(¥600)、プレモル(¥700)、ハートランド(¥650)
- ハイボール: ジャックコーク(¥700)、角ハイボール(¥650)、レモンサワー(¥600)、ジントニック(¥750)
- カクテル: カシスオレンジ(¥700)、モヒート(¥800)、マルガリータ(¥850)、ロングアイランドティー(¥900)
- ソフトドリンク: コーラ(¥400)、ウーロン茶(¥350)、ジュース(¥400)

**フードメニュー (5品)**: フライドポテト(¥500)、ナチョス(¥700)、ピザM(¥1,200)、チキンウィングス(¥800)、チーズバーガー(¥1,000)

---

## 今後の拡張アイデア

- [ ] QRコード自動生成ページ (`/admin/qr`) — 各テーブルのQRをまとめて印刷
- [ ] スタッフ呼び出し履歴の記録 (現在はステートレス通知のみ)
- [ ] 会計方法の選択 (現金 / カード / 電子マネー) をPaymentModalに追加
- [ ] 複数店舗対応 (テーブルにlocation_idを追加)
- [ ] 価格エンジンのパラメータをUIから変更できる管理画面
- [ ] キッチン/バーカウンター向け注文ディスプレイ (`/kitchen`)
- [ ] Nginxのレートリミット設定 (本番環境向け)
- [ ] `.env` ファイルによる環境変数管理 (`docker-compose.yml` の `env_file:`)
