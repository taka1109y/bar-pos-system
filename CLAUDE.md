# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 言語設定
- 常に日本語で会話する
- コメントも日本語で記述する
- エラーメッセージの説明も日本語で行う
- ドキュメントも日本語で生成する

## Commands

### Development (local, without Docker)
```bash
# Start everything concurrently (server + client dev server)
npm run dev

# Server only (port 3001, hot reload via nodemon)
cd server && npm run dev

# Client only (port 5173, Vite)
cd client && npm run dev
```

### Production (Docker)
```bash
# Full build and start
docker compose up -d --build

# Rebuild only the client (after frontend changes)
docker compose up -d --build --no-deps client

# Rebuild only the server (after backend changes)
docker compose up -d --build --no-deps server

# View logs
docker compose logs -f server
docker compose logs -f client
```

### Database
```bash
# Connect to running DB
docker compose exec postgres psql -U bar -d bardb

# Reset DB (drops and re-seeds on next server start)
docker compose exec postgres psql -U bar -d bardb -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
docker compose restart server
```

There are no automated tests. Testing is done manually with curl against `http://localhost` (Docker) or `http://localhost:3001` (local).

## Architecture

### Overview
3-container Docker stack: **PostgreSQL 16** → **Node.js/Express server** (port 3001) → **Nginx** (port 80, serves React SPA + proxies `/api/` and `/socket.io/`).

Docker volumes: `pg_data` (PostgreSQL data), `uploads` (uploaded menu images — shared between server and nginx containers).

No ORM — raw SQL via `pg` pool. No authentication.

### Server (`server/`)

**Entry point**: `index.js` — registers middleware, mounts route modules, sets up Socket.io event handlers, then runs `initDb() → seed() → seedSubcategories() → startPricingEngine()`.

**Route modules** (`server/routes/`):
- `tables.js` — CRUD; accepts `table_type` ('table'|'counter'); DELETE blocks if open orders exist (409)
- `menu.js` — CRUD with soft delete (`is_active=false`); always returns `::float` casts for numeric fields; supports subcategories; crash/reset endpoints for forced price drops. `GET /` accepts `?staff=true` to include `is_staff_only` items (default: excluded). Fields: `image_url` (filename, not URL), `tax_category` ('standard'|'reduced'), `is_staff_only`
- `orders.js` — Order lifecycle + item add/update/delete; every item mutation runs `recalcTotal()` in a transaction; `GET /open` returns all open orders with charge fields; `POST /` accepts `guest_count`, reads charge settings from `system_settings`, writes `charge_per_person` and `charge_amount` to the order at creation time
- `payments.js` — Closes orders (tax-inclusive 内税 calculation); applies late-night surcharge, discount, and gift certificate; resets table status to `available`. Splits items by `tax_category` to calculate standard (10%) and reduced (8%) tax separately; charge/late_night amounts use standard rate; discount applied to standard first then remainder to reduced
- `prices.js` — Returns `current_price` with `pct_change` vs `base_price`; price history
- `reports.js` — `GET /api/reports/daily?date=YYYY-MM-DD[&since=ISO_TIMESTAMP]`: 会計済みオーダーの日次集計。`since` はレジオープン時刻で指定した場合それ以降のみ集計。`void`/`black_cancelled` は除外。`taxable_standard`/`taxable_reduced`（税率別課税対象額）、`cancel_amount`/`cancel_count`（赤伝票）、`correction_amount`/`correction_count`（黒伝票訂正）を含む
- `receipts.js` — `GET /api/receipts?date=YYYY-MM-DD`: paid orders（およびその日に発行されたstatus='open'の赤伝票）を全item付きで返す。`POST /api/receipts/:orderId/void-and-reissue`: 当日の会計済み伝票を取消し→元オーダーを `black_cancelled` に変更し、`void`証跡レコードと `red`（赤伝票）オーダーを生成する。二重取消し防止チェックあり
- `system.js` — `GET/PATCH /api/system/settings`: tax_rate, late_night_rate, late_night_start, late_night_end, charge_enabled, charge_time_slots (JSON array of `{start, end, amount}` in 32h format), reduced_tax_rate, default_tax_category, register_open (bool), register_open_cash (int), register_opened_at (ISO string, 自動セット)
- `settings.js` — `GET/PATCH /api/settings/pricing`: runtime pricing engine parameters
- `kitchen.js` — Kitchen display: pending order items; PATCH to mark as served
- `uploads.js` — `POST /api/uploads/menu-images`: multer file upload (images only, 5MB limit); resolves filename conflicts by appending `_1`, `_2`, etc.; stores files in `server/uploads/` (Docker: `uploads` volume mounted at `/app/uploads`)
- `maintenance.js` — `POST /api/maintenance/archive`: 指定日数（`before_days`, デフォルト90日）より古い`paid`オーダーのorder_items・ordersをトランザクションで一括削除。削除前件数チェックあり
- `logs.js` — `GET /api/logs`: 会計ログ検索。クエリパラメータ: `from`/`to`(YYYY-MM-DD)、`receipt_type`('normal'|'red'|'void'|'black_cancelled')、`payment_method`('cash'|'card'|'emoney')、`limit`(max 200, デフォルト50)、`offset`。`{ orders, total, limit, offset }` を返す

**Key services**:
- `services/socketService.js` — Singleton wrapper around Socket.io (`setIo`/`broadcast`/`broadcastToRoom`). Routes import `{ broadcast, broadcastToRoom }` from here, not from `index.js`.
- `services/pricingEngine.js` — Ticks every 30s. Uses per-item `price_step_up`/`price_step_down` (¥ amounts). Subcategory competition logic: within the same subcategory, high-demand items rise while competitor demand pulls price down. Clamps to `[min_price, max_price]`, rounds to nearest ¥25. Broadcasts `prices:updated` only when price actually changes.
- `services/pricingSettings.js` — In-memory runtime config for pricing engine parameters (TICK_INTERVAL_MS, WINDOW_SECONDS, PRICE_STEP_DOWN, HISTORY_KEEP, PRUNE_EVENTS_SECONDS).

**Utility modules** (`server/utils/`):
- `utils/time.js` — `TZ`（`process.env.TZ_REPORT` or `'Asia/Tokyo'`）、`nowInTZ()`、`todayJST()`（`sv-SE` locale でJST今日日付）、`checkLateNight(startH, endH)`（32時間表記対応）。タイムゾーン関連処理はすべてここを使う
- `utils/validate.js` — `assertDateFormat(value, fieldName)`: YYYY-MM-DD 形式チェック（不正なら `{ status, error }` を throw）、`clampInt(value, min, max, defaultVal)`: 整数クランプ

**Database schema** (`db/schema.sql`):
- `tables` — id, name, table_type ('table'|'counter'), status
- `categories` — id, name, sort_order, crash_pct
- `subcategories` — id, category_id, name, sort_order, crash_pct
- `menu_items` — id, category_id, subcategory_id, name, base_price, current_price, min_price, max_price, price_step_up, price_step_down, is_drink, is_active, crash_enabled, is_crashed, image_url (filename only), tax_category ('standard'|'reduced'), is_staff_only
- `orders` — id, table_id, status, total_amount, payment_method, opened_at, closed_at, guest_count, discount_amount, tax_rate, tax_amount, late_night_rate, late_night_amount, memo, gift_cert_amount, gift_cert_no_change, charge_per_person, charge_amount, receipt_type ('normal'|'black_cancelled'|'void'|'red', default 'normal'), original_order_id (赤伝票・取消し証跡で使用)
- `order_items` — id, order_id, menu_item_id, quantity, unit_price, item_name, status, created_at
- `pricing_events` — demand tracking, pruned after 10 min
- `price_history` — last 60 records per item (sparkline data)
- `system_settings` — key-value table (tax_rate, late_night_rate, late_night_start, late_night_end, charge_enabled, charge_time_slots, reduced_tax_rate, default_tax_category, register_open, register_open_cash, register_opened_at)

### Client (`client/src/`)

**Routing** (`App.jsx`):
- `/start` → `RegisterStartPage` — レジオープン前画面。金種入力モーダル（`CashDenomModal`）で開店準備金を入力し `register_open: true` をPATCH → `/` へリダイレクト。`register_open` が既に true なら `/` へリダイレクト（`RedirectIfOpen` ガード）
- `/` → `POSPage` — staff-facing POS (table grid, menu, order panel, payment)。`register_open` が false なら `/start` へリダイレクト（`RequireRegisterOpen` ガード）
- `/board` → `BoardPage` — price display board with sparklines。`register_open` が false なら「レジオープン前です」画面を表示（`PublicGuard`）
- `/table/:tableId` → `TablePage` — customer-facing order screen; shows WelcomeScreen (guest count selection) on first visit, then menu. Guest count selection immediately creates the order (and charges) in the DB.（`PublicGuard`）
- `/kitchen` → `KitchenPage` — kitchen display（`PublicGuard`）

**ルートガード**:
- `RequireRegisterOpen` — `register_open=false` なら `/start` へ Navigate
- `RedirectIfOpen` — `register_open=true` なら `/` へ Navigate
- `PublicGuard` — `register_open=false` なら `RegisterClosedScreen`（時計表示）を返す、true なら children を表示

**POSPage navigation** (sidebar、折りたたみ可能):
グループ「操作」:
- レジ画面 (id: `pos`) — TableGrid + OrderPanel
- レジクローズ (id: `close`) — RegisterClosePage（日計レポート・金種入力・PDF出力・クローズ確定）

グループ「マスタ管理」:
- テーブル管理 (id: `tables`) — TableManager
- 商品管理 (id: `menu`) — MenuManager
- カテゴリ管理 (id: `categories`) — CategoryManager
- 価格エンジン (id: `pricing`) — PricingSettings

グループ「分析」:
- 売上管理 (id: `reports`) — ReportsPage
- 伝票情報 (id: `receipts`) — ReceiptsPage

グループ「設定」:
- システム管理 (id: `system`) — SystemSettingsPage

フッター（外部リンク）:
- 価格ボード ↗ — opens /board in new tab
- キッチン ↗ — opens /kitchen in new tab

**Data layer**:
- `api.js` — Fetch wrapper, all calls go through `BASE = /api`. 主なAPI: `getStaffMenu()` → `GET /menu?staff=true`; `getAllMenu()` → `GET /menu/all`; `uploadMenuImage(formData)` → `POST /api/uploads/menu-images` (multipart, returns `{ filename }`); `voidAndReissue(orderId)` → `POST /api/receipts/:orderId/void-and-reissue`; `getLogs({from,to,receipt_type,payment_method,limit,offset})` → `GET /api/logs`; `archiveOldData(beforeDays)` → `POST /api/maintenance/archive`; `getSystemSettings()` / `updateSystemSettings(data)` → `GET/PATCH /api/system/settings`
- `socket.js` — Single shared Socket.io client instance (auto-reconnect)
- `store/usePriceStore.js` — Zustand store; `initPrices()` on page load, `updatePrices()` on `prices:updated` socket event; tracks `direction` and `flash` for animations
- `components/pos/Sparkline.jsx` — SVG sparkline chart; fetches `GET /api/prices/:id/history?limit=14` via TanStack Query (staleTime: 30s, refetchInterval: 35s); appends live price from usePriceStore as the final point; color: emerald (up) / red (down) / slate (flat); renders polyline + fill area + base_price dashed line + end dot
- `components/pos/MenuGrid.jsx` — Customer screen (`showImage=true`): 3-column grid, `aspect-video` images with `object-contain`. Staff screen (`showImage=false`): 2-column grid. All cards show `<Sparkline>` below price (replaces the former h-1 bar)

**Real-time pattern**: Components register named socket handlers in `useEffect` and pass the same reference to `socket.off()` on cleanup. Never use `socket.off(event)` without a handler reference — it removes all listeners for that event.

**Data fetching**: TanStack Query v5 for all API calls. Real-time updates from socket use `queryClient.setQueryData()` directly (avoids HTTP re-fetch). Optimistic updates in `addItemMutation` with rollback on error.

### Key Data Flow

**Surge pricing loop**:
1. `POST /api/orders/:id/items` → inserts into `pricing_events`
2. PricingEngine tick (30s) → reads demand per item and per subcategory, computes target price using `price_step_up`/`price_step_down`, updates `menu_items.current_price`, broadcasts `prices:updated`
3. Client `usePriceStore.updatePrices()` → UI re-renders with flash animation

**Payment calculation** (order of operations, all prices are tax-inclusive 内税):
1. Split items into `standard` (tax_category='standard') and `reduced` (tax_category='reduced') groups
2. standardItemsTotal = sum of standard items; reducedItemsTotal = sum of reduced items
3. taxable_standard = standardItemsTotal + charge_amount + late_night_amount − discount_amount (min 0)
4. discountRemainder = max(0, discount − standardItemsTotal − charge − late_night)
5. taxable_reduced = max(0, reducedItemsTotal − discountRemainder)
6. tax_amount = `Math.round(taxable_standard × tax_rate / (1 + tax_rate))` + `Math.round(taxable_reduced × reduced_tax_rate / (1 + reduced_tax_rate))` — for display only
7. total = taxable_standard + taxable_reduced
8. gift_cert_amount reduces the cash amount due (if gift_cert_no_change=true, capped at total)

late_night_amount = `itemsSubtotal × late_night_rate` (applied to items only — charge excluded)

**Table lifecycle**: `available` → (customer selects guest count on TablePage → order created immediately with charge) → `occupied` → (payment) → `available`. Status changes broadcast as `table:status_changed`.

**Table cards** (POSPage TableGrid): Occupied tables show total_amount (items + charge, 税込み) + guest count + elapsed time (hh:mm since opened_at). Empty tables render the same DOM block with `invisible` class to maintain equal card heights. The card updates immediately after order creation (before any items) via `order:updated` socket event invalidating `['orders-open']`.

## Important Constraints

- **Numeric types**: PostgreSQL `NUMERIC` columns return as strings in `pg`. Always use `::float` casts in SQL queries. Never rely on `RETURNING *` for numeric fields — re-fetch with explicit casts or cast inline.
- **Soft delete**: Menu items are never hard-deleted; use `is_active = FALSE`. Orders and order items can be hard-deleted.
- **Transactions**: Any mutation to `order_items` must call `recalcTotal(client, orderId)` within the same transaction using the pool client, not the module-level `query()`.
- **Socket rooms**: Table-specific events use room `table:${tableId}`. Subscribe via `client:subscribe_table` / `client:unsubscribe_table` events.
- **Late-night time format**: 32-hour format (e.g., 29 = 5:00 AM next day). Server-side check uses JST via `toLocaleString('en-US', { timeZone: 'Asia/Tokyo' })`. Client-side check uses `new Date().getHours()` with same 32h math.
- **System settings**: Always read from `system_settings` table at payment time — never cache in application memory.
- **`order:updated` socket payload**: Always include `{ tableId, orderId, items, total, chargeAmount, chargePerPerson, guestCount }`. Missing charge fields cause the client to fall back to stale cached values; include all fields in every broadcast.
- **Charge creation**: `POST /api/orders` reads `charge_enabled` and `charge_time_slots` from `system_settings` at order creation time and stores the resolved `charge_per_person` and `charge_amount` on the order row. Charge is not recalculated after order creation.
- **Tax-inclusive pricing**: All menu prices are 税込み. Do not add tax on top of `total_amount`. `tax_amount` is back-calculated for display only. Two rates: `tax_rate` (standard, default 10%) and `reduced_tax_rate` (reduced, default 8%), set per-item via `menu_items.tax_category`.
- **Crash feature**: `menu_items.crash_enabled` / `is_crashed` and `categories.crash_pct` / `subcategories.crash_pct` support forced price drops. Crash/reset endpoints exist in `menu.js`.
- **Image storage**: `menu_items.image_url` stores the **filename** (e.g., `beer.jpg`), NOT a full URL. Client constructs `/uploads/{filename}` to display images. Docker: served by Nginx directly from the `uploads` volume at `/usr/share/nginx/html/uploads/`. Local dev: served by Express static at `/uploads/`, proxied via Vite.
- **Staff-only items**: `menu_items.is_staff_only=TRUE` items are excluded from `GET /api/menu` (customer screen). Use `GET /api/menu?staff=true` (POSPage via `api.getStaffMenu()`) to include them.
- **uploads volume**: Persists across container rebuilds. Never use `docker compose down -v` unless intentionally deleting uploaded images.
- **レジ開閉フロー**: `system_settings.register_open` が `'true'` のときのみ `/` へアクセス可能。`/start` でオープン（金種入力 → `register_open: true` + `register_open_cash` PATCH）、`RegisterClosePage` でクローズ（`register_open: false` PATCH → `/start` リダイレクト）。`register_opened_at` はオープン時に自動セットされ、日計レポートの `since` パラメータとして使用される。
- **赤伝票（void-and-reissue）**: 当日の `paid` オーダーのみ操作可能。元オーダーを `black_cancelled` に変更し、`void`（証跡）と `red`（赤伝票、status='open'）を生成。二重取消し防止（`void` レコードの存在チェック）あり。`reports.js` の集計は `void`/`black_cancelled` を除外する。
- **receipt_type**: `orders.receipt_type` は `'normal'`（通常）、`'black_cancelled'`（取消し済み黒伝票）、`'void'`（取消し証跡）、`'red'`（赤伝票）の4値。新規オーダー作成時は `'normal'`（デフォルト）。


# melta UI - AI向け指示

> このDSは Claude Code でのヴァイブコーディングに最適化されている。UI生成時に必ずこのファイルから読み始めること。

**読み込みモード**:

| モード | 読むファイル | 用途 |
|--------|------------|------|
| クイック | CLAUDE.md のみ | 単体UIの生成（ボタン、カード等） |
| 標準 | + foundations/theme.md + 関連 component md | ページ単位の生成 |
| MCP | MCP ツール（`get_token` / `get_component`）| AI ツール統合 |
| フル | 全ファイル（下記の読み順に従う） | 新規プロジェクト構築・DS変更 |

> クイックリファレンスだけで基本的なUIは生成可能。コンポーネント仕様が必要な場合のみ該当 md を追加で読み込む。

**機械可読データ**: `tokens/tokens.json`（~106トークン）+ `metadata/components.json`（28コンポーネント）

**フル読み順**: CLAUDE.md → foundations/design_philosophy.md → foundations/theme.md → foundations/ → components/ → patterns/ → foundations/prohibited.md（プロジェクト側に `foundations/theme.md` がある場合はそちらを優先）

---

## 設計原則（5つ）

1. **Layered** — Background → Surface → Text/Object の3層でUIを構成する
2. **Contrast** — テキストは背景に対してWCAG 2.1準拠（4.5:1以上）
3. **Semantic** — 色は用途で指定する（`bg-surface-primary` ≠ 生の `bg-white`）
4. **Minimal** — 1つのViewに使う色は3色まで（背景・アクセント・テキスト）
5. **Grid** — スペーシングは4の倍数を基本、8の倍数を推奨する

---

## HTMLテンプレート

> Tailwind CDN 使用時は以下を `<head>` に必ず含める。`primary-*` が未定義だとセマンティックカラーが機能しない。

```html
<script src="https://cdn.tailwindcss.com"></script>
<script>
tailwind.config = {
  theme: {
    extend: {
      colors: {
        primary: {
          50:'#f0f5ff',100:'#dde8ff',200:'#c0d4ff',300:'#95b6ff',
          400:'#6492ff',500:'#2b70ef',600:'#2250df',700:'#1a40b5',
          800:'#13318d',900:'#0e266a',950:'#07194e'
        },
        wf: { bg:'#FFFFFF', surface:'#F5F5F5', border:'#E0E0E0', text:'#333333', 'text-sub':'#888888', accent:'#666666' }
      },
      fontFamily: {
        sans: ['Inter','Hiragino Sans','Hiragino Kaku Gothic ProN','Noto Sans JP','sans-serif']
      }
    }
  }
}
</script>
<style>.text-body { color: #3d4b5f; }</style>
```

---

## クイックリファレンス

### レイアウト
```
ページ全体         : bg-gray-50 min-h-screen
ページコンテンツ   : max-w-7xl mx-auto px-8 py-12
サイドバー＋メイン : flex h-screen（ボーダー分離、gap不要）
セクション間隔     : mt-10 〜 mt-14
仕切り線           : border-t border-slate-200
```

### テキスト
```
見出し             : text-3xl font-bold text-slate-900（32px）
本文               : text-base text-body leading-relaxed（18px, line-height 2.0）
フォーム制御ラベル : 包含 <div> に leading-normal（body の lh 2.0 リセット）
空状態メッセージ   : text-base text-slate-500 text-center py-16
フォントスタック     : Inter, Hiragino Sans, Hiragino Kaku Gothic ProN, Noto Sans JP, sans-serif
```

### コンポーネント
```
カード             : bg-white rounded-xl border border-slate-200 p-6 shadow-sm
カードグリッド     : grid grid-cols-2 md:grid-cols-3 gap-6
CTAボタン（M）     : inline-flex items-center justify-center gap-2 h-10 px-4 text-[1rem] font-medium bg-primary-500 text-white rounded-lg hover:bg-primary-700 cursor-pointer
CTAボタン（L）     : inline-flex items-center justify-center gap-2 h-12 px-6 text-[1rem] font-medium bg-primary-500 text-white rounded-lg hover:bg-primary-700 cursor-pointer
CTAボタン（S）     : inline-flex items-center justify-center gap-1.5 h-8 px-3 text-[0.875rem] font-medium bg-primary-500 text-white rounded-lg hover:bg-primary-700 cursor-pointer
サブボタン         : inline-flex items-center justify-center gap-2 h-10 px-4 text-[1rem] font-medium bg-white text-slate-700 border border-slate-200 rounded-lg hover:bg-gray-50 cursor-pointer
Icon+Textボタン    : inline-flex items-center justify-center gap-2 h-10 pl-3 pr-4 text-[1rem] font-medium（アイコン側を狭く）
アイコンボタン（M）: w-10 h-10 inline-flex items-center justify-center cursor-pointer + aria-label（icon w-5 h-5）
アイコンボタン（S）: w-8 h-8 inline-flex items-center justify-center cursor-pointer + aria-label（icon w-4 h-4）
アイコンボタン（L）: w-12 h-12 inline-flex items-center justify-center cursor-pointer + aria-label（icon w-5 h-5）
入力欄             : w-full px-3 py-2 text-base border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500/50 caret-primary-500
セレクト           : appearance-none pl-3 pr-10 + relative wrapper + SVG chevron（absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4）← ネイティブ矢印は使用禁止
横並びフォーム     : flex flex-wrap items-end gap-4（外枠）+ 各 div.leading-normal > label + 要素 h-11 leading-normal（py-2 外す）+ ボタン h-11 inline-flex items-center（→ patterns/form.md 必読）
バッジ（デフォルト）: bg-slate-100 text-slate-700 px-3 py-1 rounded-full text-xs font-medium
タグ（削除可能）   : inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium + ×ボタン
フィルターチップ   : inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm border cursor-pointer + aria-selected
Alert（Info）      : flex items-start gap-3 p-4 bg-primary-50 border border-primary-200 text-primary-800 rounded-lg（border-l-4 禁止）
Alert（Success）   : flex items-start gap-3 p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg（border-l-4 禁止）
Alert（Warning）   : flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg（border-l-4 禁止）
Alert（Error）     : flex items-start gap-3 p-4 bg-red-50 border border-red-200 text-red-800 rounded-lg（border-l-4 禁止）
テーブル外枠         : bg-white rounded-xl border border-slate-200 overflow-hidden
テーブルヘッダ行     : border-b border-slate-200 bg-gray-50
テーブルヘッダセル   : <th scope="col"> text-left py-3 px-4 text-xs font-medium text-slate-500 uppercase tracking-wider
テーブルデータ行     : hover:bg-gray-50 transition-colors
テーブルデータセル   : py-3 px-4 text-sm（主値 text-slate-900 / 副値 text-body）
Accordion トリガー : w-full flex items-center justify-between py-4 text-left text-base font-medium text-slate-900 cursor-pointer
ディバイダー（水平）: border-t border-slate-200（<hr> or role="separator"）
ディバイダー（テキスト付き）: flex items-center gap-4 + 両側 flex-1 border-t border-slate-200 + 中央 text-sm text-slate-500
ディバイダー（垂直）: border-l border-slate-200 self-stretch + role="separator" aria-orientation="vertical"
Stepper Indicator  : w-8 h-8 rounded-full inline-flex items-center justify-center text-sm（Completed: bg-primary-500 text-white / Active: border-2 border-primary-500 / Upcoming: bg-slate-100 text-slate-500）
Stepper Connector  : flex-1 h-0.5 mx-3（完了区間: bg-primary-500 / 未着手: bg-slate-200）
Date Picker Trigger: w-full flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-base + Calendar アイコン
Date Picker Popup  : absolute mt-1 w-[320px] bg-white rounded-xl border border-slate-200 shadow-md z-20 p-4
Date Picker Day    : w-10 h-10 inline-flex items-center justify-center text-sm rounded-lg（Selected: bg-primary-500 text-white / Today: font-semibold text-primary-500）
```

### アイコン
```
Charcoal           : w-5 h-5 fill="currentColor" text-body ← assets/icons/{Name}.svg（プライマリ・207個）
Lucide             : w-5 h-5 stroke="currentColor" fill="none" ← assets/icons/lucide/{name}.svg（補完・15個）
小サイズ           : w-4 h-4 ← 同SVGをTailwindで縮小（Charcoal優先、Lucide補完）
アイコンボタン     : w-8/w-10/w-12 h-8/h-10/h-12（S/M/L）inline-flex items-center justify-center cursor-pointer + aria-label 必須
```

### ナビゲーション
```
サイドバー（標準）  : w-64 bg-white border-r border-slate-200 flex-shrink-0 flex flex-col h-screen
サイドバー（コンパクト）: w-16 items-center（アイコンのみ + aria-label + title 必須）
サイドバー構成       : 3ゾーン必須（Header + nav + Footer mt-auto border-t）
サイドバー nav       : <nav aria-label="メインナビゲーション"> 必須
ナビアイコン         : flex-shrink-0 を付与
ナビ（Active）     : flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-primary-500 bg-primary-50 rounded-lg + aria-current="page"
ナビ（Default）    : flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-body hover:bg-gray-50 rounded-lg transition-colors
タブ underline（Active）  : text-sm font-semibold text-primary-500 border-b-2 border-primary-500 cursor-default
タブ underline（Inactive）: text-sm font-medium text-slate-500 border-b-2 border-transparent hover:text-slate-700 cursor-pointer
タブ bar（Active）  : flex-1 relative flex items-center justify-center py-4 text-sm font-semibold text-slate-900 + インジケーターバー（w-56px h-4px bg-primary-500 rounded absolute bottom-0）
タブ bar（Inactive）: flex-1 relative flex items-center justify-center py-4 text-sm font-medium text-slate-400 hover:text-slate-600 hover:bg-slate-100
パンくずリスト     : text-sm + text-slate-500 hover:text-slate-700 / 現在ページ text-slate-900 font-medium
ページネーション   : w-10 h-10 rounded-lg cursor-pointer + Active bg-primary-500 text-white / Inactive bg-white border
```

### データ・フィードバック
```
アバター（M）      : w-10 h-10 rounded-full（イニシャル: bg-primary-50 text-primary-500 font-medium）+ role="img" aria-label="名前"
プログレスバー     : bg-slate-200 rounded-full h-2（フィル: bg-primary-500 rounded-full h-2）+ role="progressbar" aria-valuenow aria-valuemin="0" aria-valuemax="100"
スケルトン         : bg-slate-200 rounded-md skeleton-pulse + aria-busy="true" role="status"
空状態             : text-center py-16 + アイコン(w-16 h-16 bg-slate-100 rounded-full) + 見出し + 説明 + CTAボタン
ツールチップ       : bg-slate-600 text-white text-sm rounded-lg shadow-sm px-3 py-2（width: max-content, max-width: 20rem）
```

### ワイヤーフレーム（低忠実度プロトタイプ用）
```
背景               : bg-wf-bg (#FFFFFF)
サーフェス         : bg-wf-surface (#F5F5F5)
ボーダー           : border-wf-border (#E0E0E0)
テキスト           : text-wf-text (#333333)
サブテキスト       : text-wf-text-sub (#888888)
アクセント         : text-wf-accent / bg-wf-accent (#666666)
CSS変数            : --wf-bg / --wf-surface / --wf-border / --wf-text / --wf-text-sub / --wf-accent
```

---

## 禁止パターン要約

| 禁止 | 代替 |
|------|------|
| `text-black` | `text-slate-900` |
| `bg-gray-300`以上の背景 | `bg-gray-50` 〜 `bg-gray-200` |
| `rounded-none` on cards | `rounded-xl` |
| `shadow-lg` / `shadow-2xl` | `shadow-sm` 〜 `shadow-md`（オーバーレイ: `shadow-xl`） |
| `border-gray-100` | `border-slate-200` |
| `text-gray-400` for body | `text-body` (#3d4b5f) |
| `py-0.5` for buttons | `h-8` 以上（S: `h-8` / M: `h-10` / L: `h-12`） |
| カード/Alert上部・左端のカラーバー（`border-t-4` / `border-l-4` / 色付き `div`） | `border border-*-200 rounded-lg` で全周ボーダー |
| カード直下の `<fieldset>` + `<legend>` | `<div>` + `<h2>` でセクション見出し |
| 日付セレクトの均等幅（`grid-cols-3`） | `flex` + 年 `w-28`、月・日 `w-20` |
| 色だけで情報伝達 | アイコン/テキストを併用 |
| `tracking-tight` | 見出し1%、本文2%を基本 |
| プレースホルダーのみのラベル | 必ず `<label>` を使用 |
| 派手なグラデーション / ネオンカラー / 過剰なアニメーション | セマンティックカラー、150〜300ms フィードバックに限定 |
| フォーム制御ラベル包含divの `leading-normal` 省略 | 包含 `<div>` に `leading-normal` 付与 |
| `bg-indigo-*` / `bg-blue-*` 等のハードコード | `primary-*` を使用（foundations/theme.md で定義） |
| `<th>` の `scope` 省略 | `<th scope="col">` 必須 |
| `<nav>` の `aria-label` 省略 | `aria-label="メインナビゲーション"` 必須 |

> 全禁止パターン（76項目）+ AI生成パターンの排除: `foundations/prohibited.md` 参照

---

## Foundation / コンポーネント一覧

**Foundations (10)**: color, spacing, typography, elevation, radius, motion, z-index, icons, accessibility, emotional-feedback — 各 `foundations/{name}.md`

**Components (28)**: button, card, checkbox, modal, sidebar, textfield, select, dropdown, radio, toggle, toast, list, badge, tag, table, tooltip, tabs, breadcrumb, pagination, avatar, progress, alert, accordion, skeleton, datepicker, divider, stepper, copy-button — 各 `components/{name}.md`

**Skills (1)**: design-review — `skills/design-review/SKILL.md`（DSチェック・違反検出・修正提案）

**Patterns (5)**: layout, form, navigation, interaction-states, responsive — 各 `patterns/{name}.md`

---

## タスクベース読み込みガイド

| タスク | 読み込むファイル（順序） |
|--------|------------------------|
| 単体コンポーネント生成 | CLAUDE.md のみ |
| ページ生成 | + foundations/theme.md → patterns/layout.md → 関連 component md |
| ダークモード対応 | + foundations/theme.md（CSS変数）→ foundations/color.md（Dark列） |
| フォーム画面 | + patterns/form.md → textfield / select / checkbox / button |
| データ一覧 | + table.md → pagination.md → badge.md |
| ダッシュボード | + foundations/theme.md → layout.md → card / table / progress / badge |
| 設定画面 | + tabs.md → toggle / select / radio |
| モーダル / 確認 | + modal.md → button.md |
| Loading / 空状態 | + skeleton.md → interaction-states.md |
| 通知フィードバック | + toast.md → alert.md → interaction-states.md |
| サイドバー付きページ | + sidebar.md → layout.md |
| ナビゲーション | + navigation.md → sidebar.md → tabs / breadcrumb |
| レスポンシブ対応 | + patterns/responsive.md → layout.md |
| アクセシビリティ確認 | + foundations/accessibility.md |
| アイコン選択 | + foundations/icons.md |
| ウィザード / ステップ画面 | + stepper.md → button.md |
| 日付入力フォーム | + datepicker.md → textfield.md → form.md |
| セクション分割 | + divider.md → layout.md |
| テーマカスタマイズ | foundations/theme.md → foundations/color.md（CLAUDE.md 不要） |
| DS変更 / 新コンポーネント | フル読み込み |

---

## テーマ・カラー変数・ダークモード

> テーマ設定・CSS変数定義・ダークモード切替: `foundations/theme.md` を参照。

<!-- ダークモードを有効にするには OFF → ON に変更してください -->
| 設定 | 値 |
|------|-----|
| **ダークモード** | `OFF` |

- `OFF`: ライトモードのみで設計・生成する（デフォルト）
- `ON`: ダークモード対応を含めて設計・生成する（`foundations/theme.md` + `foundations/color.md` Dark列 を参照）

---

## Design Context

> このセクションは `/teach-impeccable` で自動生成される。フォーク後に再実行すると、あなたのプロジェクトに合わせた内容に上書きされる。

### Users
- **対象**: B2B / B2C 両方の汎用デザインシステム
- **エンドユーザー**: 業務SaaSを使うビジネスパーソンから、ECサイト・予約サービスの一般消費者まで
- **利用コンテキスト**: ダッシュボード、管理画面、EC、予約、学習、医療、行政など幅広いドメイン
- **DSの消費者**: 人間の開発者・デザイナー、および Claude Code / Cursor 等の AI コード生成エージェント

### Brand Personality
- **3語で表すと**: 静謐・精緻・温もり（Quiet · Precise · Warm）
- **声のトーン**: 「声を張らずに伝わる」— 主張しすぎない、でも確かに伝わる
- **コアメタファー**: 「機能的な黒子であり、たまに微笑む」
- **感情目標**: 心地よい集中 → 洗練された効率 → 穏やかな親しみ（この順で優先）

### Aesthetic Direction
- **ビジュアルトーン**: ミニマルだが冷たくない。フラットな基盤に Background → Surface → Text の3層で奥行きを出す
- **参考プロダクト**: Linear / Notion（高速でミニマル、プロフェッショナルなSaaS）、Stripe / Vercel（洗練されたデベロッパー向けデザイン）
- **アンチリファレンス**: 派手なグラデーション・ネオンカラーの SaaS 風デザイン、Bootstrap 的な没個性テンプレート
- **テーマ**: 上部「テーマ・カラー変数・ダークモード」セクションの設定値に従う

### Design Principles
1. **Content First** — UIは黒子。コンテンツが主役であり、装飾ではなく構造で伝える
2. **Calm Confidence** — 信頼感を静かに醸成する。過剰な演出より、正確なスペーシングとコントラストで品質を示す
3. **Inclusive by Default** — WCAG 2.1 AA準拠はオプションではなくデフォルト。あらゆるユーザーが迷わず使える
4. **Systematic Warmth** — 4px グリッド・セマンティックカラー・制限されたシャドウで一貫性を保ちつつ、Success 時の微細なアニメーションで人間味を添える
5. **Machine-Readable** — トークン・メタデータ・セマンティック命名により、AIエージェントが正確にUIを生成できる
