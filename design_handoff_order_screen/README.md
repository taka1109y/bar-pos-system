# Handoff: Sports Bar FANZONE — お客様用タブレット注文画面

## Overview
スポーツバー「FANZONE」のテーブル据え置きタブレット（Android 10インチ前後）向けのセルフオーダー画面です。お客様が席から直接メニューを閲覧・注文できます。注文は1品ずつ即時送信する方式で、価格はリアルタイムで変動します（ダイナミックプライシング）。

## About the Design Files
このフォルダ内の `order-screen.html` は **デザインリファレンス（HTML プロトタイプ）** です。プロダクションコードとして直接使用することを意図したものではありません。開発者はこのHTMLが示す見た目・インタラクション・構造を参照し、既存のコードベース（React / Vue / Flutter / ネイティブ Android など）のパターン・ライブラリを使って **同等のUIを再実装** してください。

## Fidelity
**High-fidelity（高精度）**: 最終的な色、タイポグラフィ、スペーシング、インタラクションを含むピクセル精度のモックアップです。デザインに忠実に再現してください。

---

## Screens / Views

### 1. 注文メイン画面（Order Screen）

**目的**: お客様がカテゴリを選び、商品を選択して注文を送信する主画面。

**全体レイアウト**
- キャンバスサイズ: **1024 × 600px**（10インチ Android ランドスケープ）
- 縦に3分割:
  - トップバー: 高さ 52px
  - ティッカーバー: 高さ 22px
  - ボディ: 残り全体（高さ 526px）

**ボディの横分割**（左→右）:
| エリア | 幅 | 説明 |
|---|---|---|
| サイドバー | 130px | カテゴリ選択 |
| メニューグリッド | flex（残り全体） | 商品カード3列グリッド |
| 注文履歴パネル | 210px | 注文ログ＋合計 |

---

### 2. トップバー

**レイアウト**: `display: flex; justify-content: space-between; align-items: center; padding: 0 16px;`

**左：ロゴエリア**
- アイコン: 30×30px, `border-radius: 6px`, 背景 `#e52233`, 中央に "F"（Bebas Neue, 18px）
  - box-shadow: `0 0 14px rgba(229,34,51,0.35)`
- 店名: `SPORTS BAR FANZONE`（Bebas Neue, 18px, letter-spacing: 3px, 色 `#f0f0f5`）
- サブタイトル: `DYNAMIC PRICE ORDER SYSTEM`（8px, letter-spacing: 2px, 色 `#7a7a90`）

**右：テーブル番号 + 時計**
- テーブル番号ブロック: 背景 `#1e1e28`, border `1px solid #252532`, border-radius 8px, padding `4px 14px`
  - ラベル: `テーブル`（8px, color `#7a7a90`, letter-spacing: 2px）
  - 番号: `No.5`（Bebas Neue, 20px, color `#ffc531`, letter-spacing: 2px）
- 時計: Barlow Condensed, 20px, `#f0f0f5`（HH:MM 形式）
- 注文状況テキスト: 8px, `#7a7a90`

**背景**: `linear-gradient(90deg, #0b0b0f, #18181f 50%, #0b0b0f)`
上端に 1px の赤いライン: `linear-gradient(90deg, transparent, #e52233, transparent)` opacity 0.7

---

### 3. ティッカーバー（価格テロップ）

- 高さ: 22px, 背景 `#0a0a0f`, 下端 border `1px solid #252532`
- 商品名・現在価格・騰落率を横スクロール表示
- テキスト: 9px, letter-spacing: 1px, color `#7a7a90`
- アニメーション: 30秒で左スクロール (`animation: ticker 30s linear infinite`)
- 内容は全メニューの先頭12品（商品名 ¥価格 ▲/▼騰落率%）

---

### 4. サイドバー（130px幅）

背景: `#14141a`、右端 border: `1px solid #252532`

**メインカテゴリ**（上部）
- ラベル: `メインカテゴリ`（8px, #3a3a50, letter-spacing: 2px）
- 2つのボタン: ドリンク🍺 / フード🍔
- アクティブ状態: `linear-gradient(135deg, #e52233, #9a1020)`, outline `1px solid #e52233`, box-shadow `0 0 16px rgba(229,34,51,0.35)`
- 非アクティブ: 背景透明, color `#7a7a90`
- ボタンサイズ: padding `12px 6px`, margin `3px 6px`, border-radius 10px
- 絵文字: 24px, テキスト: 11px / 700

**区切り線**: `border-top: 1px solid #252532; margin: 8px 10px`

**サブカテゴリ**（下部）
- ラベル: `サブカテゴリ`（8px, #3a3a50）
- ドリンク: ビール🍺 / カクテル・サワー🍹 / ウイスキー🥃 / ソフトドリンク🥤
- フード: サラダ🥗 / おつまみ🍢 / 揚げ物🍟 / パスタ🍝 / デザート🍨
- アクティブ: カテゴリカラーの薄背景 + カラーborder、右端に小ドット
- ボタン: padding `8px 10px`, border-radius 8px, font 11px
- アクティブ時 font-weight: 700、非アクティブ: 400

**カテゴリカラー対応表**:
| サブカテゴリ | グラデーション | glowColor |
|---|---|---|
| ビール | `#7b4f0d → #c88820` | `#c88820` |
| カクテル | `#5a0a3a → #c0286a` | `#c0286a` |
| ウイスキー | `#3a1a06 → #8b4513` | `#8b4513` |
| ソフトドリンク | `#003d3a → #00a896` | `#00a896` |
| サラダ | `#0d2e0d → #2e7d32` | `#2e7d32` |
| おつまみ | `#3a1f00 → #bf6000` | `#bf6000` |
| 揚げ物 | `#3d2800 → #e09000` | `#e09000` |
| パスタ | `#2e1a0e → #9b5e2a` | `#9b5e2a` |
| デザート | `#2d0a3a → #8b2fc9` | `#8b2fc9` |

---

### 5. メニューカード（商品グリッド）

グリッド: `grid-template-columns: repeat(3, 1fr); gap: 9px; padding: 12px 10px`

**カード構造**（上から）:

#### 5-1. 商品画像エリア
- 高さ: 72px
- 背景: カテゴリ別グラデーション（上記テーブル参照）
- 中央に絵文字（36px）、`filter: drop-shadow(0 2px 8px <glowColor>)`
- グリッドオーバーレイ: `background-image: linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px); background-size: 12px 12px`
- 下端: `border-bottom: 1px solid rgba(255,255,255,0.07)`

#### 5-2. コンテンツエリア（padding: 10px 10px 8px）
- **商品名**: 13px, font-weight 700, color `#f0f0f5`, line-height 1.3
- **説明文**: 9px, color `#7a7a90`, line-height 1.4
- **現在価格**: Barlow Condensed 20px / 700, color `#ffc531`
  - 価格上昇時: 背景 `#00e5a020` でフラッシュアニメーション
  - 価格下降時: 背景 `#ff446620` でフラッシュアニメーション
- **騰落率バッジ**: Barlow Condensed 11px, ▲ color `#00e5a0` / ▼ color `#ff4466`
- **スパークラインチャート**: SVG、幅 160px × 高さ 36px
  - 上昇トレンド: stroke `#00e5a0`（ネオングリーン）
  - 下降トレンド: stroke `#ff4466`（ネオンレッド）
  - 線幅: 1.5px、末端に r=3px の円
  - エリア下部: グラデーション塗りつぶし
  - 背景: `rgba(0,0,0,0.3)`, border-radius 6px, padding `4px 4px 2px`

#### 5-3. 注文ボタン
- padding: `7px 0`、幅100%
- 背景: `linear-gradient(90deg, #e52233, #9a1020)`
- テキスト: `注　文`（11px, 700, 白, letter-spacing: 2px）
- タップ時: グラデーション逆転、カード全体が scale(0.97)、border color `#e52233`

**カード全体スタイル**:
- 背景: `#1e1e28`, border `1px solid #252532`, border-radius: 12px
- box-shadow: `0 2px 10px rgba(0,0,0,0.5)`
- タップアクティブ: box-shadow `0 0 18px rgba(229,34,51,0.35)`

---

### 6. 注文確認モーダル

タップ → モーダル表示（注文送信前の確認）

- オーバーレイ: `rgba(0,0,0,0.8)` + `backdrop-filter: blur(6px)`
- モーダルボックス: 320×auto px, 背景 `#14141a`, border `1px solid #e52233`, border-radius 18px
- box-shadow: `0 0 48px rgba(229,34,51,0.35)`
- アニメーション: `slide-up 0.2s ease`（translateY(20px) → 0）

内容（上から）:
- カテゴリ絵文字（38px）
- タイトル `注文を確認`（Bebas Neue, 22px, letter-spacing: 3px）
- 商品名（15px, 700, `#ffc531`）
- 説明文（12px, `#7a7a90`）
- 現在価格（Barlow Condensed, 28px, `#e52233`）
- ボタン行:
  - キャンセル: 背景 `#1e1e28`, color `#7a7a90`, border `1px solid #252532`
  - 注文する: 背景 `linear-gradient(135deg, #e52233, #9a1020)`, 白文字, box-shadow `0 0 20px rgba(229,34,51,0.35)`

---

### 7. 注文送信トースト

注文確定後、画面上部中央に表示（約2秒）

- 背景: `#00e5a0`（ネオングリーン）、color `#001a10`（ダーク）
- border-radius: 50px（全丸）、padding `9px 26px`
- font: 13px, 700
- box-shadow: `0 0 32px rgba(0,229,160,0.3)`
- アニメーション: `sent-pop 0.25s ease`（scale 0.85→1.05→1, opacity 0→1）
- 内容: `✓ 「{商品名}」を注文しました ¥{価格}`

---

### 8. 注文履歴パネル（210px幅）

**ヘッダー**: 背景 `#1e1e28`, padding `10px 12px 8px`
- タイトル `注文履歴`（Bebas Neue, 15px, letter-spacing: 3px, `#7a7a90`）
- 件数テキスト: 9px, `#3a3a50`

**リスト部分**: overflow-y scroll, scrollbar width 4px
- 各行: padding `7px 12px`, border-bottom `1px solid #252532`
- 直近の行: 背景 `rgba(0,229,160,0.05)` でハイライト
- 行内 左: 商品名（11px, 700, `#f0f0f5`）+ 送信時刻（9px, `#00e5a0`）
- 行内 右: 注文時価格（Barlow Condensed, 13px, `#ffc531`）

**合計エリア**: border-top `2px solid #e52233`, padding 12px
- 背景: `linear-gradient(180deg, #14141a, #150a0c)`
- `合計金額` ラベル: 9px, `#7a7a90`, letter-spacing: 2px
- 金額: Barlow Condensed, 24px, `#ffc531`
- 注記: `※ 税込表示`（9px, `#3a3a50`）

---

## Interactions & Behavior

### 価格変動ロジック（ダイナミックプライシング）
- 更新頻度: **2,500ms ごと**
- アルゴリズム: 平均回帰型ランダムウォーク
  ```
  drift = (basePrice - lastPrice) * 0.05
  shock = (Math.random() - 0.5) * basePrice * 0.08
  newPrice = max(100, round(lastPrice + drift + shock))
  ```
- 各商品に価格履歴を保持（直近24件）
- 価格変化時: カードの価格表示がフラッシュアニメーション

### 注文フロー
1. 商品カードをタップ → 確認モーダル表示（その時点の現在価格を表示）
2. 「注文する」タップ → モーダルを閉じ、履歴パネルに追加、トースト表示
3. 「キャンセル」タップ → モーダルを閉じるだけ
4. トーストは 2,000ms 後に自動消滅

### 注文データ永続化
- `localStorage` の `fanzone_orders` キーに JSON 配列として保存
- 各注文エントリのスキーマ:
  ```json
  {
    "id": 21,
    "sub": "fried",
    "name": "唐揚げ",
    "basePrice": 580,
    "desc": "醤油ベース 6個",
    "uid": 1714120800000,
    "time": "19:45",
    "orderPrice": 612
  }
  ```

### テーブル番号
- `localStorage` の `fanzone_table` キーから取得（デフォルト `"5"`）
- スタッフが起動時に設定する想定

---

## State Management

| 状態変数 | 型 | 説明 |
|---|---|---|
| `mainCat` | `'drink' \| 'food'` | 選択中のメインカテゴリ |
| `subCat` | string | 選択中のサブカテゴリID |
| `orders` | Order[] | 注文済みリスト（localStorage同期） |
| `pending` | `{ item, currentPrice } \| null` | 確認モーダル中の注文 |
| `toast` | Order \| null | 表示中のトースト |
| `priceMap` | `{ [itemId: number]: number[] }` | 商品ごとの価格履歴（24件） |

---

## Design Tokens

### Colors
```
--bg:           #0b0b0f   /* ページ背景 */
--surface:      #14141a   /* パネル背景 */
--surface2:     #1e1e28   /* カード背景 */
--border:       #252532   /* ボーダー */
--red:          #e52233   /* プライマリアクセント */
--red-glow:     rgba(229,34,51,0.35)
--neon:         #00e5a0   /* 成功・上昇 */
--neon-glow:    rgba(0,229,160,0.3)
--text:         #f0f0f5   /* メインテキスト */
--text-dim:     #7a7a90   /* サブテキスト */
--text-muted:   #3a3a50   /* 非活性テキスト */
--gold:         #ffc531   /* 価格表示 */
--up:           #00e5a0   /* 上昇色 */
--down:         #ff4466   /* 下降色 */
```

### Typography
| 用途 | Font | Size | Weight |
|---|---|---|---|
| ロゴ・ラベル見出し | Bebas Neue | 15–22px | 400 |
| 価格・バッジ | Barlow Condensed | 11–28px | 600–700 |
| 本文・ボタン | Noto Sans JP | 8–15px | 400–900 |

### Spacing
- カードグリッド gap: 9px
- カードパディング: 10px
- セクションパディング: 12px

### Border Radius
- カード: 12px
- モーダル: 18px
- ボタン: 8–10px
- アイコン: 6px
- トースト: 50px（完全丸）

### Animations
```css
@keyframes flash-in  { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:none} }
@keyframes slide-up  { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:none} }
@keyframes sent-pop  { 0%{transform:translateX(-50%) scale(0.85);opacity:0} 60%{transform:translateX(-50%) scale(1.05)} 100%{transform:translateX(-50%) scale(1);opacity:1} }
@keyframes ticker    { from{transform:translateX(0)} to{transform:translateX(-50%)} }
@keyframes price-up  { 0%{background:#00e5a020} 100%{background:transparent} }
@keyframes price-down{ 0%{background:#ff446620} 100%{background:transparent} }
```

---

## Assets

| アセット | 説明 |
|---|---|
| 商品画像 | 現在はカテゴリ別グラデーション＋絵文字プレースホルダー。実際の料理写真（72×幅px、各カード上部）と差し替えてください |
| 店舗ロゴ | 現在は `F` の文字ロゴ。SVGまたはPNG（推奨: 30×30px以上） |

---

## Files

| ファイル | 説明 |
|---|---|
| `order-screen.html` | フルデザインリファレンス（React + Babel、単一ファイル） |
| `README.md` | 本ドキュメント |

---

## Notes for Developer

1. **タブレット固定サイズ**: このUIは 1024×600px のキャンバスに固定されています。実装時はデバイスの画面サイズに合わせてスケーリング（`transform: scale()`）またはレスポンシブ対応を検討してください。
2. **価格変動APIの接続**: 現在のプロトタイプはフロントエンドでランダムウォークを生成しています。実際のシステムでは、バックエンドAPIまたはWebSocketに接続してください。
3. **注文送信API**: `handleConfirm` 関数の中で、バックエンドへの注文送信APIコールを追加してください。
4. **テーブル番号管理**: `localStorage` から取得していますが、実装時はQRコードやスタッフ用管理画面と連携することを推奨します。
5. **スパークライン**: SVGで実装しています。Recharts / Victory / Chart.js などのライブラリに置き換えてもかまいません。
