# Sports Bar POS System

スポーツバー向けPOSシステム。**株価変動型ダイナミックプライシング**が特徴で、注文の多いドリンクほどリアルタイムで価格が上昇する。

---

## 起動方法

### 本番 (Docker)

```bash
docker compose up -d --build  # ビルドして起動
docker compose up -d          # 既存イメージで起動
docker compose down           # 停止
docker compose down -v        # 停止 + 全ボリューム削除（DB・画像データも消える）
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
| `http://localhost/board` | **大型ディスプレイ** | 全ドリンクの現在価格をリアルタイムで表示（TV投影用） |
| `http://localhost/table/:id` | **お客さん** | セルフ注文・注文確認モーダル（QRコードで配布）。商品画像付き3列グリッド |
| `http://localhost/kitchen` | **キッチン / バー** | 注文アイテム一覧・ステータス管理（提供完了 / キャンセル） |

### 管理画面のナビゲーション

左サイドバーから各機能に切り替える（インライン表示、管理系はポップアップモーダル）:

| メニュー | 内容 |
|---|---|
| レジ画面 | テーブルグリッド表示。使用中テーブルは合計金額と滞在時間(hh:mm)を表示。テーブル選択で注文パネルを開く |
| テーブル管理 | テーブル / カウンターのCRUD（タイプ別に色分け表示） |
| 商品管理 | メニューCRUD・カテゴリ/サブカテゴリ別一覧・価格帯・価格ステップ設定・商品画像アップロード・税率区分・従業員専用フラグ |
| カテゴリ管理 | カテゴリ / サブカテゴリのCRUD |
| 価格設定 | 価格エンジンのパラメータをUIから変更 |
| 売上管理 | 日次レポート・商品別ランキング |
| 伝票情報 | 会計済み伝票の詳細一覧（日付フィルター・明細展開） |
| システム管理 | 消費税率（標準・軽減）・深夜料金（料率・時間帯）・チャージ設定・デフォルト税率区分 |
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
                     │ /uploads/* (静的画像: uploads volumeから直接配信)
┌────────────────────▼────────────────────────────────┐
│  バックエンド (server - Node.js 20:3001)             │
│  Express v4 + Socket.io v4 + multer                 │
│  ├── REST API (tables, menu, orders, payments,      │
│  │            prices, reports, receipts,            │
│  │            system, settings, kitchen, uploads)   │
│  └── 価格エンジン (30秒ごとに価格を自動更新)          │
└────────────────────┬────────────────────────────────┘
                     │ DATABASE_URL (postgres://)
┌────────────────────▼────────────────────────────────┐
│  DB (postgres:16-alpine)                            │
│  ボリューム: pg_data (DBデータ永続化)                │
└─────────────────────────────────────────────────────┘

Docker volumes:
  pg_data  — PostgreSQL データ
  uploads  — アップロード画像 (server:/app/uploads ↔ nginx:/usr/share/nginx/html/uploads)
```

---

## ディレクトリ構成

```
bar-pos-system/
├── docker-compose.yml          # 3コンテナ定義 + uploads volume
├── package.json                # npm workspaces ルート
│
├── server/
│   ├── Dockerfile
│   ├── index.js                # エントリーポイント・Socket.io・/uploads静的配信・404ハンドラー
│   ├── uploads/                # アップロード画像（Docker: volumes/uploads にマウント）
│   ├── db/
│   │   ├── database.js         # pg.Pool + query() ヘルパー + initDb()
│   │   ├── schema.sql          # PostgreSQL DDL (9テーブル + インデックス)
│   │   └── seed.js             # 初期データ
│   ├── routes/
│   │   ├── tables.js           # GET/POST/PATCH/DELETE /api/tables
│   │   ├── menu.js             # GET/POST/PATCH/DELETE /api/menu (?staff=true対応)
│   │   ├── orders.js           # GET/POST/PATCH/DELETE /api/orders
│   │   ├── payments.js         # POST /api/payments/:orderId (標準・軽減税率対応)
│   │   ├── prices.js           # GET /api/prices  GET /api/prices/:id/history
│   │   ├── reports.js          # GET /api/reports/daily
│   │   ├── receipts.js         # GET /api/receipts?date=YYYY-MM-DD
│   │   ├── system.js           # GET/PATCH /api/system/settings
│   │   ├── settings.js         # GET/PATCH /api/settings/pricing
│   │   ├── kitchen.js          # GET/PATCH /api/kitchen
│   │   └── uploads.js          # POST /api/uploads/menu-images (multer・ファイル名衝突解消)
│   └── services/
│       ├── pricingEngine.js    # ダイナミック価格エンジン (30秒ティック)
│       ├── pricingSettings.js  # 価格エンジンのランタイム設定
│       └── socketService.js    # Socket.io io インスタンス共有
│
└── client/
    ├── Dockerfile              # multi-stage: node build → nginx serve
    ├── nginx.conf              # /api/ + /socket.io/ をserverへproxy、/uploads/ をvolumeから直接配信
    ├── vite.config.js          # 開発時プロキシ設定 (/api, /uploads, /socket.io)
    └── src/
        ├── App.jsx             # BrowserRouter + QueryClientProvider
        ├── api.js              # fetch ベースのAPIクライアント (getStaffMenu, uploadMenuImage 含む)
        ├── socket.js           # Socket.io クライアントシングルトン
        ├── index.css           # Tailwind + アニメーション
        ├── store/
        │   └── usePriceStore.js  # Zustand: ライブ価格状態 (flash方向付き)
        ├── pages/
        │   ├── POSPage.jsx             # 従業員管理画面 (サイドバーレイアウト)
        │   ├── BoardPage.jsx           # TV価格ボード
        │   ├── TablePage.jsx           # お客さん注文画面 (3列グリッド・商品画像表示)
        │   ├── KitchenPage.jsx         # キッチン表示
        │   ├── ReportsPage.jsx         # 売上レポート
        │   ├── ReceiptsPage.jsx        # 伝票情報
        │   ├── RegisterClosePage.jsx   # レジ精算レポート
        │   └── SystemSettingsPage.jsx  # システム設定 (消費税・軽減税率・深夜料金・チャージ)
        └── components/
            ├── layout/TickerBar.jsx        # 横スクロール価格ティッカー
            ├── pos/TableGrid.jsx           # テーブルグリッド (金額・滞在時間表示)
            ├── pos/OrderPanel.jsx          # 注文サイドパネル
            ├── pos/MenuGrid.jsx            # カテゴリタブ + メニュー選択 (showImage prop)
            ├── pos/Sparkline.jsx           # SVGスパークライン (price_history + ライブ価格)
            ├── pos/PaymentModal.jsx        # 会計モーダル (割引・深夜料金・消費税・商品券)
            ├── tables/TableManager.jsx     # テーブル/カウンターCRUD
            ├── menu/MenuManager.jsx        # メニューCRUD (画像アップロード・税率区分・従業員専用)
            └── menu/CategoryManager.jsx    # カテゴリ/サブカテゴリCRUD
```

---

## 技術スタック

| 層 | 技術 |
|----|------|
| フロントエンド | React 19, Vite 8, Tailwind CSS v4 |
| 状態管理 | Zustand (ライブ価格), TanStack Query v5 (サーバー状態・オプティミスティック更新) |
| リアルタイム | Socket.io v4 (setQueryData による即時キャッシュ更新) |
| グラフ | インライン SVG (Sparkline.jsx — ライブラリ不使用) |
| ルーティング | React Router v7 |
| バックエンド | Node.js 20, Express v4, multer (画像アップロード) |
| DB | PostgreSQL 16 (pg v8) |
| インフラ | Docker Compose, nginx-alpine, uploads volume |

---

## データベーススキーマ

```
tables          テーブル席情報
                (id, name, table_type[table|counter], status)

categories      メニューカテゴリ
                (id, name, sort_order, crash_pct)

subcategories   サブカテゴリ
                (id, category_id, name, sort_order, crash_pct)

menu_items      メニュー
                (id, category_id, subcategory_id, name,
                 base_price, current_price, min_price, max_price,
                 price_step_up, price_step_down, is_drink, is_active,
                 crash_enabled, is_crashed,
                 image_url[ファイル名],
                 tax_category['standard'|'reduced'],
                 is_staff_only)

orders          注文
                (id, table_id, status[open|paid], total_amount, payment_method,
                 opened_at, closed_at, guest_count,
                 discount_amount, tax_rate, tax_amount,
                 late_night_rate, late_night_amount,
                 memo, gift_cert_amount, gift_cert_no_change,
                 charge_per_person, charge_amount)

order_items     注文明細
                (id, order_id, menu_item_id, quantity, unit_price, item_name, status)

pricing_events  価格計算用イベントログ
                (id, menu_item_id, quantity, event_time) ← 10分でプルーン

price_history   価格履歴
                (id, menu_item_id, price, recorded_at) ← スパークライン用、最大60件/商品

system_settings システム設定 key-value
                (tax_rate, late_night_rate, late_night_start, late_night_end,
                 charge_enabled, charge_time_slots,
                 reduced_tax_rate, default_tax_category)
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

会計時の計算順序（全額 税込み 内税方式）:

1. 商品を税率区分で分類: `standard`（標準10%）と `reduced`（軽減8%）
2. **深夜料金** = standardItemsSubtotal × `late_night_rate`（商品のみ、チャージは含まない）
3. **課税対象（標準）** = standardItemsTotal + charge_amount + late_night_amount − discount_amount（最小0）
4. **割引残額** = max(0, discount − standardTotal − charge − late_night)
5. **課税対象（軽減）** = max(0, reducedItemsTotal − 割引残額)
6. **消費税（表示用）** = `Math.round(課税標準 × 0.10 / 1.10)` + `Math.round(課税軽減 × 0.08 / 1.08)`
7. **合計** = 課税対象（標準）+ 課税対象（軽減）
8. **商品券** = 合計から差し引く現金決済額を減らす（gift_cert_no_change=true の場合は合計を上限にキャップ）

**深夜時間帯**: 32時間制で指定 (例: 22〜29 = 22:00〜翌5:00)。サーバー側は JST で判定。

**設定変更**: システム管理画面 または `PATCH /api/system/settings` で即時反映。

---

## Socket.io イベント仕様

| 方向 | イベント | ペイロード | 用途 |
|------|---------|-----------|------|
| Server→Client | `prices:updated` | `{ items: [{id, name, current_price, base_price, pct_change, direction}], timestamp }` | 価格変動通知 (全クライアント) |
| Server→Client | `order:updated` | `{ tableId, orderId, items, total, chargeAmount, chargePerPerson, guestCount }` | 注文変更通知 (テーブルルーム) |
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
| GET | `/api/menu` | アクティブメニュー一覧（is_staff_only 除外） |
| GET | `/api/menu?staff=true` | アクティブメニュー一覧（is_staff_only 含む・POS用） |
| GET | `/api/menu/all` | 全メニュー (非アクティブ・従業員専用 含む) |
| GET | `/api/menu/categories` | カテゴリ一覧 |
| GET | `/api/menu/subcategories` | サブカテゴリ一覧 |
| POST | `/api/menu` | メニュー作成 |
| PATCH | `/api/menu/:id` | メニュー更新 |
| DELETE | `/api/menu/:id` | メニュー削除 (soft delete: is_active=false) |
| POST | `/api/menu/crash` | 価格暴落トリガー `{ category_ids, subcategory_ids }` |
| POST | `/api/menu/crash/reset` | 暴落リセット（base_priceに戻す） |

### Uploads

| Method | Path | 説明 |
|--------|------|------|
| POST | `/api/uploads/menu-images` | 商品画像アップロード (multipart/form-data, field: `image`); 同名ファイルは `_1`/`_2`... でリネーム; returns `{ filename }` |

### Orders

| Method | Path | 説明 |
|--------|------|------|
| GET | `/api/orders/open` | 全オープン注文一覧 |
| GET | `/api/orders/table/:tableId` | テーブルの現在注文 |
| POST | `/api/orders` | 注文開始 `{ table_id, guest_count }` |
| POST | `/api/orders/:id/items` | アイテム追加 |
| PATCH | `/api/orders/:id/items/:itemId` | 数量変更 |
| DELETE | `/api/orders/:id/items/:itemId` | アイテム削除 |

### Payments / Prices / Reports / Receipts

| Method | Path | 説明 |
|--------|------|------|
| POST | `/api/payments/:orderId` | 支払い完了 `{ payment_method, discount_amount, memo, gift_cert_amount, gift_cert_no_change }` |
| GET | `/api/prices` | 全ドリンク現在価格 + 変動率 + 当日高値/安値 |
| GET | `/api/prices/:id/history?limit=N` | 価格履歴 (デフォルト30件, スパークライン用) |
| GET | `/api/reports/daily?date=YYYY-MM-DD&since=ISO` | 日次売上集計 (since: レジ開放日時フィルター) |
| GET | `/api/receipts?date=YYYY-MM-DD` | 会計済み伝票一覧 (明細・料金内訳付き) |

### System / Settings / Kitchen

| Method | Path | 説明 |
|--------|------|------|
| GET | `/api/system/settings` | 全システム設定取得 |
| PATCH | `/api/system/settings` | システム設定更新 (tax_rate, reduced_tax_rate, late_night_rate, late_night_start, late_night_end, charge_enabled, charge_time_slots, default_tax_category) |
| GET | `/api/settings/pricing` | 価格エンジンパラメータ取得 |
| PATCH | `/api/settings/pricing` | 価格エンジンパラメータ更新 |
| POST | `/api/settings/pricing/reset` | 価格エンジンパラメータをデフォルトに戻す |
| GET | `/api/kitchen/orders` | キッチン用注文アイテム一覧 |
| PATCH | `/api/kitchen/items/:itemId/serve` | アイテムを提供済みに更新 |

**エラーレスポンス共通形式**: `{ "error": "<message>" }`

---

## 環境変数

| 変数 | デフォルト | 説明 |
|------|-----------|------|
| `DATABASE_URL` | `postgres://bar:bar@localhost:5432/bardb` | PostgreSQL接続文字列 |
| `PORT` | `3001` | サーバーポート |
| `NODE_ENV` | — | `production` 時は静的配信ルートが有効 |
| `CLIENT_ORIGIN` | — | CORS 許可オリジン |

---

## データ永続化

| ボリューム | マウント先 | 内容 |
|---|---|---|
| `pg_data` | postgres:/var/lib/postgresql/data | PostgreSQL データファイル |
| `uploads` | server:/app/uploads, nginx:/usr/share/nginx/html/uploads | アップロード画像ファイル |

`docker compose down`（`-v` なし）ではボリュームは削除されない。`-v` を付けると両方のデータが消えるため注意。

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

**システム設定デフォルト値**: 消費税 10%、軽減税率 8%、深夜料金 10%、深夜時間帯 22:00〜翌5:00 (22〜29)

---

## 既知の課題

| 優先度 | 内容 |
|---|---|
| 高 | API 認証なし — 全エンドポイントが認証なしでアクセス可能 |
| 中 | フロントエンド JS バンドル未分割 |
| 低 | React エラーバウンダリなし |
| 低 | `price_history` は初回起動直後は空 (価格変動が発生するまで記録なし → スパークラインは水平線) |

---

## 今後の拡張アイデア

- [x] 会計方法の選択 (現金 / カード / 電子マネー)
- [x] 価格エンジンのパラメータをUIから変更できる管理画面
- [x] キッチン/バーカウンター向け注文ディスプレイ (`/kitchen`)
- [x] 消費税・深夜料金の設定と会計への自動適用
- [x] テーブル / カウンター管理画面
- [x] 伝票情報ページ（会計済み伝票の明細閲覧）
- [x] 商品画像のファイルアップロード (multer + Docker volume)
- [x] 消費税軽減税率（8%）対応・商品ごとの税率区分設定
- [x] 従業員専用商品（お客様注文画面に非表示）
- [x] 価格スパークライン（SVGチャート・商品カード内に表示）
- [ ] React Router の `lazy()` によるコード分割
- [ ] `.env` ファイルによる環境変数管理
- [ ] 商品画像の削除（不使用ファイルのクリーンアップ）
