# UI リデザイン設計書

**日付**: 2026-04-02  
**スコープ**: 全Web画面のUI/UXブラッシュアップ（機能変更なし）

---

## 決定事項サマリー

| 画面 | テーマ | 備考 |
|------|--------|------|
| POSPage（管理画面） | Clean Light Admin（インディゴ×ホワイト） | スタッフ操作 |
| KitchenPage（キッチン） | Clean Light Admin（POSと同一） | スタッフ操作 |
| TablePage（お客様注文） | Dark Bar（スレートブラック×アンバーゴールド） | iPad横置き2ペイン |
| BoardPage（価格ボード） | Dark Bar（同上） | 店舗内大型モニター表示 |

---

## 1. デザインシステム

### 1.1 カラーパレット

**Light Admin（POSPage / KitchenPage）**

```
背景:       #f8fafc（slate-50）
カード:     #ffffff
ボーダー:   #e2e8f0（slate-200）
テキスト:   #0f172a（slate-900）
サブテキスト: #64748b（slate-500）
アクセント: #6366f1（indigo-500）
アクセント濃: #4f46e5（indigo-600）
アクセント淡: #eef2ff（indigo-50）
成功:       #059669（emerald-600）
危険:       #dc2626（red-600）
```

**Dark Bar（TablePage / BoardPage）**

```
背景:       #0f172a（slate-900）
サブ背景:   #1e293b（slate-800）
ボーダー:   #334155（slate-700）
テキスト:   #f1f5f9（slate-100）
サブテキスト: #94a3b8（slate-400）
アクセント: #f59e0b（amber-500）
アクセント明: #fbbf24（amber-400）
上昇:       #4ade80（green-400）
下降:       #f87171（red-400）
```

### 1.2 タイポグラフィ

- フォント: `system-ui, -apple-system, 'Hiragino Sans', sans-serif`
- 見出し: `font-weight: 900`（extra-bold）
- ラベル: `font-weight: 700`（bold）
- 本文: `font-weight: 400`（regular）
- 数値（金額）: `font-variant-numeric: tabular-nums`

### 1.3 角丸・シャドウ

- カード: `border-radius: 12px`、`box-shadow: 0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)`
- ボタン（大）: `border-radius: 12px`
- ボタン（小）: `border-radius: 8px`
- タグ・バッジ: `border-radius: 9999px`（pill）
- モーダル: `border-radius: 16px`

---

## 2. 画面別設計

### 2.1 POSPage（管理画面）

**全体レイアウト**: 左サイドバー（幅 `w-56`）＋右メインエリア

**サイドバー**
- 背景: `white`、右ボーダー: `border-r border-slate-200`
- ブランドエリア: ロゴ（🍺）＋ "Sports Bar" / "POS 管理" のテキスト、`bg-gradient-to-b from-indigo-600 to-indigo-700` のヘッダーバー
- ナビゲーションボタン: アクティブ時 `bg-indigo-50 text-indigo-700 border-l-2 border-indigo-600`、非アクティブ時 `text-slate-600 hover:bg-slate-50`
- 外部リンク（価格ボード・キッチン）: 区切り線で分離、`text-slate-400` で控えめに
- ステータスエリア（下部）: テーブル稼働数をバッジ表示

**メインヘッダー**
- 背景: `white`、下ボーダー: `border-b border-slate-200`
- 現在ビューのタイトル＋説明

**TableGrid（テーブル一覧）**
- グリッド: `grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 p-6`
- カードサイズ統一（`min-h-[120px]`）
- 空席: ボーダー `border-slate-200`、テキスト `text-slate-300`
- 在席（テーブル）: ボーダー `border-indigo-300`、ヘッダー `bg-indigo-50`、金額 `text-indigo-700`
- 在席（カウンター）: ボーダー `border-amber-300`、ヘッダー `bg-amber-50`
- 選択中: `ring-2 ring-indigo-500 ring-offset-2`
- 経過時間: アイコン `⏱` + `text-slate-400`

**OrderPanel（注文パネル）**
- 右固定パネル（幅 `w-96`）
- ヘッダー: `bg-slate-50`、テーブル名＋席数
- メニューグリッド: `grid-cols-2 gap-3`、カードは `hover:shadow-md hover:border-indigo-300`
- 注文明細行: `bg-slate-50 rounded-xl`、数量ボタン `bg-slate-200 hover:bg-slate-300`
- フッター: 合計金額を大きく（`text-3xl font-black`）、会計ボタン `bg-emerald-600`
- 確認モーダル: `rounded-2xl shadow-2xl`、キャンセル `bg-slate-100`、実行 `bg-indigo-600`

**MenuGrid（メニュー選択）**
- カテゴリタブ: アクティブ `bg-indigo-600 text-white`、非アクティブ `border border-slate-200`
- サブカテゴリタブ: アクティブ `bg-slate-700 text-white`
- 商品カード: 価格 `text-indigo-700 font-black`、価格変動バー `bg-indigo-100`、上昇 `bg-emerald-500`、下降 `bg-red-400`

**PaymentModal**
- オーバーレイ: `bg-black/50`
- モーダル: `bg-white rounded-2xl max-w-md`
- 支払い方法ボタン: 選択時 `bg-indigo-600 text-white ring-2 ring-indigo-300`
- 合計金額: `text-4xl font-black text-slate-900`
- 支払いボタン: `bg-emerald-600 py-4 text-lg font-black`

### 2.2 KitchenPage（キッチン）

**全体**: Light Admin テーマ（白背景）。ただし視認性のため行の文字サイズを大きめに設定。

**ヘッダー**
- 背景: `white`、下ボーダー `border-b border-slate-200`、`sticky top-0`
- タイトル「キッチン」+ 対応件数バッジ（`bg-amber-100 text-amber-700`）

**テーブルレイアウト**
- ヘッダー行: `bg-slate-50 border-b border-slate-200`
- 通常行: `bg-white hover:bg-slate-50`
- 警告行（10分超）: `bg-red-50 border-l-4 border-red-500`
- 提供完了ボタン: `bg-emerald-600 hover:bg-emerald-500 text-white`
- キャンセルボタン: `bg-slate-100 hover:bg-red-100 hover:text-red-700`
- 経過時間（警告）: `text-red-600 font-bold`

**キャンセル確認モーダル**
- 管理画面と同じ Light Admin スタイル

### 2.3 TablePage（お客様注文 — iPad横置き）

**全体レイアウト**: `flex flex-row` の横置き2ペイン（`min-h-screen`）

**左ペイン（メニュー）**: `flex-1`
- ヘッダー: `bg-slate-900` + グラデーションライン `bg-amber-500/20`
- TickerBar: `bg-slate-950 text-amber-400`、スクロール
- カテゴリタブ: アクティブ `bg-amber-500 text-slate-900 font-black`
- サブカテゴリタブ: アクティブ `bg-slate-700 text-white`
- 商品カード: `bg-slate-800 border border-slate-700 hover:border-amber-500/50`
  - 商品名: `text-slate-200`
  - 価格: `text-amber-400 font-black text-xl`
  - 上昇: `text-green-400`、下降: `text-red-400`
  - 価格バー: `bg-slate-700`、上昇 `bg-green-500`、下降 `bg-red-500`
  - グリッド: `grid-cols-3 lg:grid-cols-4 gap-3`（iPadの広さを活用）

**右ペイン（注文サマリー）**: 固定幅 `w-80`
- 背景: `bg-slate-950 border-l border-slate-700`
- ヘッダー「注文内容」: `text-amber-400 font-bold`
- 注文アイテム行: `bg-slate-800 rounded-xl`
  - 商品名: `text-slate-100`
  - 数量コントロール: `−`（`bg-slate-700`）/ `+`（`bg-amber-500 text-slate-900`）
  - 小計: `text-amber-400 font-bold`
- フッター合計: `bg-amber-500`、金額 `text-slate-900 font-black text-2xl`

**注文確認ボトムシート**（変更なし — スライドアップアニメーション維持）
- 背景: `bg-slate-800 rounded-t-3xl`
- 注文ボタン: `bg-amber-500 text-slate-900 font-black`

### 2.4 BoardPage（価格ボード — 大型モニター）

**全体**: `min-h-screen bg-slate-950`、パディング `p-10`

**ヘッダー**
- ブランド: ロゴ + "SPORTS BAR" `text-4xl font-black tracking-wider`
- サブテキスト: "LIVE DRINK PRICES" `text-slate-500 tracking-[0.3em]`
- 時計: `font-mono text-amber-400 text-2xl`

**PriceCard**
- サイズ: 大型モニター向けに余白・フォントを拡大
- 上昇: `bg-green-950/60 border-green-700`、価格 `text-green-300`
- 下降: `bg-red-950/60 border-red-700`、価格 `text-red-300`
- 中立: `bg-slate-800 border-slate-700`、価格 `text-slate-300`
- 価格: `text-5xl font-black`（拡大）
- スパークライン: 維持
- ベース価格表示: `text-slate-500 text-sm`

**グリッド**: `grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-6`

---

## 3. 共通コンポーネント

### アニメーション（既存を維持・活用）
- `flash-up` / `flash-down`: 価格変動フラッシュ（`index.css` 定義済み）
- `slide-up`: ボトムシート
- `pop-in`: モーダル出現
- `fade-in`: オーバーレイ

### フォームUI（SystemSettingsPage / PricingSettings）
- Light Admin テーマに統一
- `Section` コンポーネント: ヘッダー `bg-slate-50`、本体 `bg-white`
- 入力フィールド: `border-slate-300 focus:ring-indigo-500`
- 保存ボタン: 通常 `bg-indigo-600`、保存済み `bg-emerald-500`
- 注意書き: `bg-amber-50 border-amber-200 text-amber-700`

### ReportsPage / ReceiptsPage
- Light Admin テーマ
- StatCard: `bg-white border-slate-200 shadow-sm`
- バーグラフ: `bg-indigo-500`
- 伸票カード: `bg-white border-slate-200`、展開アイコン `▶` → 回転

---

## 4. 実装方針

- **Tailwind CSS**: 既存クラスを置き換える形で実装。新しいユーティリティクラスの追加は不要
- **機能ロジック変更なし**: ハンドラ・API呼び出し・Socket.ioイベント・クエリは一切変更しない
- **`index.css`**: アニメーション定義はすべて維持。新規アニメーションは追加しない
- **レスポンシブ**: POSPage は既存のブレークポイントを維持。TablePage は iPad 横置き（landscape）に最適化

---

## 5. 変更ファイル一覧

```
client/src/index.css                         — フォント定義追加のみ
client/src/pages/POSPage.jsx                 — サイドバー・ヘッダー刷新
client/src/pages/TablePage.jsx               — 横置き2ペインレイアウトに全面変更
client/src/pages/BoardPage.jsx               — カード拡大・ヘッダー強化
client/src/pages/KitchenPage.jsx             — Light Admin テーマに変更
client/src/pages/ReportsPage.jsx             — Light Admin スタイル統一
client/src/pages/ReceiptsPage.jsx            — Light Admin スタイル統一
client/src/pages/SystemSettingsPage.jsx      — Light Admin スタイル統一
client/src/components/pos/TableGrid.jsx      — カード刷新
client/src/components/pos/OrderPanel.jsx     — パネル刷新
client/src/components/pos/MenuGrid.jsx       — タブ・カード刷新
client/src/components/pos/PaymentModal.jsx   — モーダル刷新
client/src/components/board/PriceCard.jsx    — 大型モニター向け拡大
client/src/components/layout/TickerBar.jsx   — Dark Bar スタイル統一
client/src/components/menu/MenuManager.jsx   — Light Admin スタイル統一
client/src/components/menu/CategoryManager.jsx — Light Admin スタイル統一
client/src/components/menu/PricingSettings.jsx — Light Admin スタイル統一
client/src/components/tables/TableManager.jsx  — Light Admin スタイル統一
```
