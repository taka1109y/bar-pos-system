# 株価暴落機能 設計書

**Date:** 2026-04-03  
**Feature:** 株価暴落（Flash Price Crash）

---

## 概要

オペレーターがシステム管理画面からカテゴリ・サブカテゴリ単位で価格暴落を発動できる機能。暴落許可フラグが設定されたドリンクの `current_price` を、事前設定した割引率に基づいて下限価格以下に一時的に引き下げる。解除ボタンで即座に基準価格へ復元する。

---

## DBスキーマ変更

```sql
-- カテゴリに暴落割引率を追加
ALTER TABLE categories ADD COLUMN IF NOT EXISTS crash_pct NUMERIC(5,2) NOT NULL DEFAULT 0;

-- サブカテゴリにも暴落割引率を追加
ALTER TABLE subcategories ADD COLUMN IF NOT EXISTS crash_pct NUMERIC(5,2) NOT NULL DEFAULT 0;

-- 商品には暴落許可フラグのみ
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS crash_enabled BOOLEAN NOT NULL DEFAULT FALSE;
```

### 暴落価格の計算式

```
crash_price = round(min_price × (1 − crash_pct/100) / 25) × 25
```

既存の ¥25 丸めルールに準拠。

### 適用ルール（優先順位）

1. 商品にサブカテゴリがあり、そのサブカテゴリが選択されている → そのサブカテゴリの `crash_pct` を使用
2. 商品のカテゴリが選択されている → そのカテゴリの `crash_pct` を使用
3. いずれでもない → スキップ

加えて、`crash_enabled = true` の商品のみが対象。

---

## サーバー変更

### 新規ルートファイル `server/routes/crash.js`

| エンドポイント | メソッド | 動作 |
|---|---|---|
| `/api/menu/crash` | POST | 指定カテゴリ/サブカテゴリ内の `crash_enabled=true` 商品の `current_price` を crash_price に更新 → `prices:updated` ブロードキャスト |
| `/api/menu/crash/reset` | POST | 全アクティブ商品の `current_price` を `base_price` にリセット → `prices:updated` ブロードキャスト |

**リクエストボディ（`POST /api/menu/crash`）:**
```json
{
  "category_ids": [1, 2],
  "subcategory_ids": [3]
}
```

**レスポンス（両エンドポイント共通）:**
```json
{ "updated": 8 }
```

### `server/routes/menu.js` 変更

- `ITEM_SELECT` に `m.crash_enabled` を追加
- `PATCH /api/menu/:id` に `crash_enabled` フィールドを追加
- `GET /api/menu/categories` と `GET /api/menu/subcategories` レスポンスに `crash_pct` を含める
- `PATCH /api/menu/categories/:id` と `PATCH /api/menu/subcategories/:id` に `crash_pct` 更新を追加

### `server/routes/menu.js` へのルート追加（推奨）

`crash.js` を別ファイルにせず、`menu.js` 内の `/:id` ルートより前に `POST /crash` と `POST /crash/reset` を追加する。こうすることで Express が `/crash` を `:id` パラメータとして誤解釈しない。

### pricingEngine との共存

pricingEngine は変更なし。crash_price は min_price を下回るため、次の 30 秒ティックでエンジンが min_price にクランプして自然に戻る。解除ボタンは即座に base_price へリセット。

---

## クライアント変更

### `client/src/api.js`

以下の2エントリを追加：

```js
triggerCrash: (data) => req('/menu/crash', { method: 'POST', body: JSON.stringify(data) }),
resetCrash: () => req('/menu/crash/reset', { method: 'POST' }),
```

### `client/src/components/menu/CategoryManager.jsx`

カテゴリ編集モーダルに `crash_pct（%）` 入力フィールドを追加。  
サブカテゴリ編集モーダルにも同様に追加。

### `client/src/components/menu/MenuManager.jsx`

`MenuItemForm` の `is_drink === true` 時に表示するブロックに以下を追加：

```
☑ 暴落許可（crash_enabled）
```

既存の価格変動設定ブロック（`price_step_up`/`price_step_down`）と同じ indigo-50 背景内に配置。

### `client/src/pages/SystemSettingsPage.jsx`

**新 Section「株価暴落」を追加：**

```
[株価暴落設定]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  [🔻 暴落を実行]  [↩ 暴落解除]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

- 「暴落を実行」→ CrashModal を開く
- 「暴落解除」→ 確認ダイアログ後 `POST /api/menu/crash/reset`、成功で「解除しました」表示

**CrashModal（SystemSettingsPage 内に定義）：**

```
カテゴリ / サブカテゴリを選択してください
────────────────────────────────────────
☑ ビール（暴落率: 30%）
    ☑ 国産ビール（暴落率: 25%）
    ☐ 輸入ビール（暴落率: 40%）
☐ ウイスキー（暴落率: 20%）
    ☐ シングルモルト（暴落率: 35%）
────────────────────────────────────────
対象商品: 8 商品が暴落します
[実行]  [キャンセル]
```

動作：
- カテゴリにチェック → 配下のサブカテゴリも全選択
- サブカテゴリを個別に外すことも可能
- 「対象商品: N 商品」はチェック状態に応じてリアルタイムに計算（フロントエンドで `crash_enabled` フラグ済み商品をカウント）
- 「実行」→ `POST /api/menu/crash` → モーダルを閉じ、「暴落を実行しました」トースト表示

---

## データフロー

```
オペレーター
 ↓ CrashModal で対象選択
POST /api/menu/crash { category_ids, subcategory_ids }
 ↓ サーバー: crash_enabled=true の対象商品を計算・更新
 ↓ broadcast('prices:updated', prices)
クライアント usePriceStore.updatePrices()
 ↓ BoardPage / TablePage / POSPage が price flash アニメーション付きで更新
```

---

## 対象外・制約

- `crash_enabled = false` の商品は暴落対象外
- `is_active = false` の商品は暴落対象外
- 暴落解除は全アクティブ商品を `base_price` に戻す（選択したカテゴリのみではない）
- crash_pct = 0 のカテゴリを選択しても current_price の変化は 0 のみ（エラーにはしない）
