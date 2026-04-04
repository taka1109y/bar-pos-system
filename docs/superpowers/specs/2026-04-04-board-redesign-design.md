# Board Page Redesign — Design Spec

**Date:** 2026-04-04  
**Scope:** BoardPage UI変更（カードグリッド → テーブル行一覧）+ API拡張（day_high/day_low）

---

## 目標

参考画像（`docs/img/board.png`）のように、金融ボード風のテーブル行スタイルで価格を表示する。  
現行のカードグリッド＋Sparklineレイアウトを廃止し、1商品1行の一覧に変更する。

---

## バックエンド変更

### `server/routes/prices.js`

**`GET /api/prices`** のレスポンスに `day_high` / `day_low` を追加する。

- `price_history` テーブルから当日（JST: `Asia/Tokyo`）の `MAX(price)` / `MIN(price)` をサブクエリで計算し LEFT JOIN する。
- 当日の履歴がない場合は `current_price` を代替値とする（COALESCE）。
- `TZ` 定数として `process.env.TZ_REPORT || 'Asia/Tokyo'` を使用する（既存パターンに準拠）。

**レスポンス例:**
```json
{
  "id": 1,
  "name": "生ビール",
  "base_price": 500,
  "current_price": 575,
  "pct_change": 15.0,
  "direction": "up",
  "day_high": 600,
  "day_low": 475
}
```

**`prices:updated` ソケットイベント** も同フィールドを含むよう `pricingEngine.js` を更新する。  
（pricingEngine が broadcast する items 配列にも `day_high` / `day_low` を加える）

---

## フロントエンド変更

### `client/src/pages/BoardPage.jsx`

- カードグリッド（`grid` + `PriceCard`）を廃止。
- テーブル構造（`<table>` または flex 行）に変更。
- ヘッダー行・Clock コンポーネントは維持。

### `client/src/components/board/PriceRow.jsx`（新規）

`PriceCard.jsx` を廃止し `PriceRow.jsx` に置き換える。  
`Sparkline.jsx` は不使用（削除対象だが、他から参照されていないため削除してよい）。

#### 列定義

| 列 | データ | 色 |
|---|---|---|
| 商品名 | `item.name` | `text-slate-400`（グレー） |
| ベースプライス | `¥{base_price}` | `text-slate-400`（グレー） |
| 現在値 | `¥{current_price}` | 常に黄色（`text-amber-300`） |
| 変動幅（金額） | `{current_price - base_price}` | 上昇=緑 / 下降=赤 / 同値=グレー |
| 変動幅（%） | `{pct_change}%` | 上昇=緑 / 下降=赤 / 同値=グレー |
| 同日高値 | `¥{day_high}` | `text-slate-400`（商品名と同色） |
| 同日底値 | `¥{day_low}` | `text-slate-400`（商品名と同色） |

#### 変動幅の表示ルール

- 上昇（`pct_change > 0`）: 符号なし。例: `75` / `15.0%`
- 下降（`pct_change < 0`）: `-` 付き。例: `-75` / `-15.0%`
- 同値（`pct_change === 0`）: `0` / `0.0%`（グレー）

#### 行背景色

- 上昇: `bg-green-950/70`
- 下降: `bg-red-950/70`
- 同値: `bg-slate-800/60`

#### その他

- `usePriceStore` の `day_high` / `day_low` は `updatePrices` で既存フィールドと同様に merge される（ストア変更不要）。
- `useQuery` による `price_history` 取得は不要になるため削除。

---

## 削除対象ファイル

- `client/src/components/board/PriceCard.jsx` — `PriceRow.jsx` に置き換え
- `client/src/components/board/Sparkline.jsx` — 不使用

---

## 変更しないもの

- `usePriceStore.js` — 構造変更不要（新フィールドは自動 merge）
- `api.js` — `getPriceHistory` は削除してもよいが、他ページから使用されていなければ削除、されていれば残す
- Socket.io のイベント名・購読ロジック — 変更なし
