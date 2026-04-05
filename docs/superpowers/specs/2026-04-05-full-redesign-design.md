# Full UI Redesign — melta UI 準拠

**Date:** 2026-04-05  
**Status:** Approved

---

## 概要

全ページを CLAUDE.md に追加された melta UI デザインシステムに準拠してリデザインする。機能変更は一切行わず、ビジュアル（色・タイポグラフィ・コンポーネント）のみ変更する。

---

## 決定事項

| 項目 | 決定内容 |
|------|---------|
| テーマ分割 | スタッフ向け（POSPage, KitchenPage）= ライト。顧客/ボード向け（BoardPage, TablePage）= ダーク維持 |
| アクセント色 | `primary-500: #2b70ef`（melta blue）。既存 indigo をすべて置換 |
| ナビアイコン | 絵文字 → Lucide SVG アイコン |
| サイドバー | デフォルト展開（224px、アイコン+ラベル）。トグルボタンで折りたたみ（56px、アイコンのみ）。展開ボタンは折りたたみ時のブランドヘッダー直下に表示 |
| 対象範囲 | 全ページ + 全サブビュー（MenuManager, CategoryManager, TableManager, PricingSettings, ReportsPage, ReceiptsPage, SystemSettingsPage, PaymentModal 等）+ モーダル |

---

## カラーシステム

```
背景         : bg-gray-50  (#f9fafb)
サーフェス    : bg-white
ボーダー      : border-slate-200 (#e2e8f0)
メインテキスト : text-slate-900 (#0f172a)
サブテキスト  : text-slate-500 (#64748b)
アクセント    : primary-500 (#2b70ef)
アクセント薄  : primary-50 (#f0f5ff), primary-100 (#dde8ff)
危険色        : red-500 (#ef4444), bg-red-50
```

ダークページ（BoardPage, TablePage）は現状の slate-950/900 パレットを維持。

---

## タイポグラフィ

```
フォント      : Inter, Hiragino Sans, Hiragino Kaku Gothic ProN, Noto Sans JP, sans-serif
見出し        : font-bold text-slate-900
本文          : text-sm text-slate-700
サブ          : text-xs text-slate-500
```

---

## コンポーネント仕様

### サイドバー（POSPage）

- **展開時（デフォルト）**: `width: 224px`、ブランドヘッダー（ロゴ + テキスト + 折りたたみボタン `←`）+ ナビリスト（アイコン+ラベル） + フッターステータス
- **折りたたみ時**: `width: 56px`、ブランドヘッダー（ロゴ + 展開ボタン `→`）+ ナビリスト（アイコンのみ、中央揃え）+ フッター数字のみ
- **アクティブ状態**: `bg-primary-50 text-primary-700`
- **ホバー**: `hover:bg-slate-50`
- **transition**: `width 0.2s ease`
- **外部リンク**（価格ボード、キッチン）: テキスト `text-slate-400`、`↗` サフィックス

### ナビアイコン対応表

| メニュー | Lucide SVG |
|---------|-----------|
| レジ画面 | `LayoutGrid` (rect×4) |
| テーブル管理 | `Briefcase` |
| 商品管理 | `ClipboardList` |
| カテゴリ管理 | `Tag` |
| 価格エンジン | `SunMedium` (sun) |
| 売上管理 | `BarChart2` |
| 伝票情報 | `FileText` |
| システム管理 | `Settings` |
| 価格ボード | `Monitor` |
| キッチン | `Coffee` |

### ページシェル共通（スタッフ向け）

```
ページ背景   : bg-gray-50
コンテンツヘッダー : bg-white border-b border-slate-200 px-6 py-3.5
ヘッダー内容 : SVGアイコン(primary-500) + タイトル(font-bold text-slate-900 text-base) + サブ説明(text-xs text-slate-400)
```

### テーブルカード（TableGrid）

- **空席**: `bg-white border border-slate-200 rounded-xl`
- **在席**: `bg-white border-[1.5px] border-primary-200 rounded-xl shadow-sm shadow-primary-100/50`
- **種別バッジ**: `text-[10px] font-bold uppercase tracking-wider`、在席時 `text-primary-600`、空席時 `text-slate-400`
- **金額**: `text-base font-black text-primary-600`
- **経過時間**: `text-xs text-slate-400`、時計アイコン付き

### モーダル（ModalShell）

```
overlay      : bg-black/40
container    : bg-white rounded-xl border border-slate-200 shadow-xl max-w-md
header       : px-5 py-4 border-b border-slate-100, タイトル font-bold text-slate-900, ×ボタン SVGアイコン
body         : px-5 py-5
footer       : px-5 py-4 border-t border-slate-100, flex gap-2
```

### フォーム入力

```
input/select : w-full px-3 py-2 text-sm border border-slate-300 rounded-lg
               focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 outline-none
select       : appearance-none + 相対ラッパー + SVG chevron (absolute right-3)
label        : text-xs font-semibold text-slate-500 mb-1.5 block
トグルボタン  : アクティブ: border-primary-500 bg-primary-50 text-primary-700
              非アクティブ: border-slate-200 bg-white text-slate-600
```

### ボタン

```
CTA (M)      : h-10 px-4 text-sm font-semibold bg-primary-500 text-white rounded-lg hover:bg-primary-700
サブ          : h-10 px-4 text-sm font-medium bg-white text-slate-700 border border-slate-200 rounded-lg hover:bg-gray-50
削除/危険    : h-10 px-4 text-sm font-bold bg-red-500 text-white rounded-lg hover:bg-red-600
アイコン (S)  : w-7 h-7 border border-slate-200 rounded-lg (編集)
              w-7 h-7 border border-red-200 bg-red-50 rounded-lg (削除)
```

### テーブル（リストビュー）

```
外枠         : bg-white rounded-xl border border-slate-200 overflow-hidden
ヘッダー行   : bg-gray-50 border-b border-slate-200
ヘッダーセル : text-xs font-semibold text-slate-500 uppercase tracking-wider py-2.5 px-4
データ行     : border-b border-slate-50 hover:bg-gray-50 transition-colors
データセル   : text-sm py-2.5 px-4
```

### バッジ

```
テーブル種別  : テーブル → bg-primary-50 text-primary-600
              カウンター → bg-emerald-50 text-emerald-700
状態バッジ   : bg-slate-100 text-slate-600 rounded-full px-2.5 py-0.5 text-xs font-semibold
```

### KitchenPage 固有

- **ヘッダー**: melta ページシェル共通に統一。キッチンアイコン（amber-100 背景）は維持
- **対応中カウント**: `bg-amber-100 text-amber-800` バッジ
- **提供完了ボタン**: `bg-primary-500`（現在の emerald から変更）
- **10分超の緊急行**: `bg-red-50 border-l-[3px] border-red-500` 維持

---

## ファイル変更対象一覧

### ページ（フル変更）
- `client/src/pages/POSPage.jsx` — サイドバー全面刷新（折りたたみ機能追加）、ヘッダー
- `client/src/pages/KitchenPage.jsx` — meltaライトテーマ
- `client/src/pages/BoardPage.jsx` — ダーク維持、タイポグラフィのみ調整（Inter font stack）
- `client/src/pages/TablePage.jsx` — ダーク維持、primary色のみ調整

### コンポーネント（フル変更）
- `client/src/components/pos/TableGrid.jsx`
- `client/src/components/pos/OrderPanel.jsx`
- `client/src/components/pos/MenuGrid.jsx`
- `client/src/components/pos/PaymentModal.jsx`
- `client/src/components/menu/MenuManager.jsx`
- `client/src/components/menu/CategoryManager.jsx`
- `client/src/components/menu/PricingSettings.jsx`
- `client/src/components/tables/TableManager.jsx`
- `client/src/components/board/PriceRow.jsx`
- `client/src/components/layout/TickerBar.jsx`
- `client/src/pages/ReportsPage.jsx`
- `client/src/pages/ReceiptsPage.jsx`
- `client/src/pages/SystemSettingsPage.jsx`

---

## 変更しないもの

- 機能ロジック（API呼び出し、Socket.io、状態管理）は一切変更しない
- BoardPage / TablePage のダークテーマ配色
- KitchenPage の緊急行（赤ハイライト）ロジック
- アニメーション（fade-in, slide-up, pop-in）のキーフレーム名

---

## ブランチ戦略

- 作業ブランチ: `feature/melta-redesign`
- 完了後 main へマージ
