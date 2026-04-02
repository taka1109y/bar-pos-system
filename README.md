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
| `http://localhost/` | **従業員** | サイドバーナビ付き管理画面。レジ・商品管理・売上管理を切り替え |
| `http://localhost/board` | **大型ディスプレイ** | 全ドリンクの現在価格をスパークライン付きで表示（TV投影用） |
| `http://localhost/table/:id` | **お客さん** | セルフ注文・注文確認モーダル・スタッフ呼び出し（QRコードで配布） |

### 管理画面のナビゲーション

左サイドバーから各機能に切り替える（モーダルではなくインライン表示）:

| メニュー | 内容 |
|---|---|
| レジ画面 | テーブルグリッド表示・テーブル選択で注文パネルを開く |
| 商品管理 | メニューCRUD・カテゴリ別一覧・価格帯設定 |
| 売上管理 | 日次レポート・時間別グラフ・商品別ランキング |
| 価格ボード ↗ | `/board` を別タブで開く |

### お客さん用QRコード

各テーブルに `http://<ホスト>/table/<テーブルID>` のQRコードを設置する。  
例: テーブル3 → `http://localhost/table/3`

---

## アーキテクチャ

```
┌─────────────────────────────────────────────────────┐
│  ブラウザ (client - nginx:80)                        │
│  React 19 + Vite 8 + Tailwind CSS v4                │
│  ├── /           従業員管理画面 (サイドバーナビ)      │
│  ├── /board      価格ボード（TV）                    │
│  └── /table/:id  お客さん注文ページ                  │
└────────────────────┬────────────────────────────────┘
                     │ HTTP /api/*  +  WebSocket /socket.io/
┌────────────────────▼────────────────────────────────┐
│  バックエンド (server - Node.js 20:3001)             │
│  Express v4 + Socket.io v4                          │
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
├── docs/
│   └── test-report-YYYY-MM-DD.md  # テスト & 技術的負債レポート
│
├── server/
│   ├── Dockerfile
│   ├── index.js                # エントリーポイント・Socket.io・404ハンドラー
│   ├── db/
│   │   ├── database.js         # pg.Pool + query() ヘルパー + initDb()
│   │   ├── schema.sql          # PostgreSQL DDL (7テーブル + インデックス)
│   │   └── seed.js             # 初期データ (テーブル12席 + メニュー19品)
│   ├── routes/
│   │   ├── tables.js           # GET/POST/PATCH/DELETE /api/tables
│   │   ├── menu.js             # GET/POST/PATCH/DELETE /api/menu
│   │   ├── orders.js           # GET/POST/PATCH/DELETE /api/orders
│   │   ├── payments.js         # POST /api/payments/:orderId
│   │   ├── reports.js          # GET /api/reports/daily|items|hourly
│   │   └── prices.js           # GET /api/prices  GET /api/prices/:id/history
│   └── services/
│       ├── pricingEngine.js    # ★ダイナミック価格エンジン (30秒ティック・1クエリ集計)
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
        ├── index.css           # Tailwind + アニメーション (slide-up, fade-in, pop-in 等)
        ├── store/
        │   └── usePriceStore.js  # Zustand: ライブ価格状態 (flash方向付き)
        ├── pages/
        │   ├── POSPage.jsx       # 従業員管理画面 (サイドバーレイアウト・ライトテーマ)
        │   ├── BoardPage.jsx     # TV価格ボード
        │   ├── TablePage.jsx     # お客さん注文画面 (確認モーダル・オプティミスティック更新)
        │   └── ReportsPage.jsx   # 売上レポート (inline or modal 両対応)
        └── components/
            ├── layout/TickerBar.jsx      # 横スクロール価格ティッカー
            ├── pos/TableGrid.jsx         # テーブルグリッド (ライトテーマ・コールバッジあり)
            ├── pos/OrderPanel.jsx        # 注文サイドパネル (ライトテーマ・Socket直接更新)
            ├── pos/MenuGrid.jsx          # カテゴリタブ + メニュー選択 (価格バー付き)
            ├── pos/PaymentModal.jsx      # 会計確認モーダル (ライトテーマ)
            ├── board/PriceCard.jsx       # 価格カード (スパークライン付き)
            ├── board/Sparkline.jsx       # Recharts ラッパー
            └── menu/MenuManager.jsx      # メニューCRUD (inline or modal 両対応)
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
tables          テーブル席情報 (id, name, capacity, status)
categories      メニューカテゴリ (id, name, sort_order)
menu_items      メニュー (id, category_id, name, base_price, current_price, min_price, max_price, is_drink, is_active)
orders          注文 (id, table_id, status[open|paid], total_amount, opened_at, closed_at)
order_items     注文明細 (id, order_id, menu_item_id, quantity, unit_price, item_name)
pricing_events  価格計算用イベントログ (id, menu_item_id, quantity, event_time)
price_history   価格履歴 (id, menu_item_id, price, recorded_at) ← スパークライン用
```

インデックス:
- `idx_pricing_events_item_time` — 価格エンジンの需要集計に使用
- `idx_price_history_item_time` — 価格履歴取得に使用
- `idx_order_items_order` — 注文明細取得に使用
- `idx_orders_table_status` — テーブル別オープン注文取得に使用

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
| `HISTORY_KEEP` | 60 | 保持する価格履歴の件数 |

**価格変動ロジック**:
1. 過去5分の全ドリンク注文数を **1クエリ** で集計 (`GROUP BY menu_item_id`)
2. `demand = 注文数 / SURGE_THRESHOLD`
3. `demand ≥ 1.0` → 目標価格を基準価格〜上限価格の間で比例計算
4. 目標価格に向けて1ティックあたり最大8%上昇 / 4%下落
5. `min_price`〜`max_price` でクランプ → 25円単位に丸め
6. 変化があれば `price_history` に記録 + Socket.io `prices:updated` をブロードキャスト

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

**クライアント側リアルタイム更新の仕組み**:  
`order:updated` 受信時に `queryClient.invalidateQueries`（HTTPリフェッチ）ではなく `queryClient.setQueryData` でキャッシュを直接更新するため、追加のHTTPリクエストが発生しない。アイテム追加時はオプティミスティック更新で即時反映し、エラー時は自動ロールバックする。

---

## APIエンドポイント

### Tables

| Method | Path | 説明 | バリデーション |
|--------|------|------|---|
| GET | `/api/tables` | 全テーブル取得 | — |
| POST | `/api/tables` | テーブル作成 `{ name, capacity }` | name: 必須・最大100文字, capacity: 正整数 |
| PATCH | `/api/tables/:id` | テーブル更新 `{ name?, capacity?, status? }` | — |
| DELETE | `/api/tables/:id` | テーブル削除 | オープン注文があれば **409** |

### Menu

| Method | Path | 説明 | バリデーション |
|--------|------|------|---|
| GET | `/api/menu` | アクティブメニュー一覧 (カテゴリ情報付き) | — |
| GET | `/api/menu/all` | 全メニュー (非アクティブ含む) | — |
| GET | `/api/menu/categories` | カテゴリ一覧 | — |
| POST | `/api/menu` | メニュー作成 `{ category_id, name, base_price, ... }` | name: 必須・最大100文字, base_price: 0以上 |
| PATCH | `/api/menu/:id` | メニュー更新 | — |
| DELETE | `/api/menu/:id` | メニュー削除 (soft delete: is_active=false) | — |
| POST | `/api/menu/categories` | カテゴリ作成 | — |

### Orders

| Method | Path | 説明 |
|--------|------|------|
| GET | `/api/orders/table/:tableId` | テーブルの現在注文 (openのみ) |
| POST | `/api/orders` | 注文開始 `{ table_id }` — 重複時409, 不正table_id時400 |
| POST | `/api/orders/:id/items` | アイテム追加 `{ menu_item_id, quantity }` — 同一アイテムは数量累積 |
| PATCH | `/api/orders/:id/items/:itemId` | 数量変更 `{ quantity }` — quantity=0 で削除 |
| DELETE | `/api/orders/:id/items/:itemId` | アイテム削除 |

### Payments / Prices / Reports

| Method | Path | 説明 |
|--------|------|------|
| POST | `/api/payments/:orderId` | 支払い完了 → テーブルをavailableに・Socket通知 |
| GET | `/api/prices` | 全ドリンク現在価格 + 変動率 (`pct_change`, `direction`) |
| GET | `/api/prices/:id/history?limit=N` | 価格履歴 (スパークライン用) |
| GET | `/api/reports/daily?date=YYYY-MM-DD` | 日次売上 (総売上・件数・平均単価・商品ランキング) |
| GET | `/api/reports/hourly?date=YYYY-MM-DD` | 時間別売上 |
| GET | `/api/reports/items?start=&end=` | 商品別売上 |

**エラーレスポンス共通形式**: `{ "error": "<message>" }`

| ステータス | 条件 |
|---|---|
| 400 | 必須パラメータ不足・バリデーション違反・FK制約違反 |
| 404 | リソース未存在・APIエンドポイント未定義 |
| 409 | 重複注文・オープン注文ありテーブルの削除 |
| 500 | 予期しないサーバーエラー |

---

## 環境変数

| 変数 | デフォルト | 説明 |
|------|-----------|------|
| `DATABASE_URL` | `postgres://bar:bar@localhost:5432/bardb` | PostgreSQL接続文字列 |
| `PORT` | `3001` | サーバーポート |
| `NODE_ENV` | — | `production` 時は静的配信ルートが有効になる |
| `CLIENT_ORIGIN` | (なし) | 追加許可するCORSオリジン |

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

## 既知の課題 (残存技術的負債)

詳細は `docs/test-report-2026-04-01.md` を参照。

| 優先度 | 内容 |
|---|---|
| 高 | API 認証なし — 全エンドポイントが認証なしでアクセス可能 |
| 中 | `tables.status` にDB制約なし (任意の文字列を設定できる) |
| 中 | フロントエンド JS バンドル 724KB — コード分割未実装 |
| 低 | React エラーバウンダリなし |
| 低 | `price_history` は初回起動直後は空 (価格変動が発生するまで記録なし) |

---

## 今後の拡張アイデア

- [x] 会計方法の選択 (現金 / カード / 電子マネー) — `2026-04-02` 実装済
- [x] 価格エンジンのパラメータをUIから変更できる管理画面 — `2026-04-02` 実装済
- [x] キッチン/バーカウンター向け注文ディスプレイ (`/kitchen`) — `2026-04-02` 実装済
- [ ] React Router の `lazy()` によるコード分割
- [ ] `.env` ファイルによる環境変数管理 (`docker-compose.yml` の `env_file:`)
- [ ] スタッフ呼び出し履歴の記録
