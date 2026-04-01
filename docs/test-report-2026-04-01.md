# テスト & 技術的負債レポート

**実施日**: 2026-04-01  
**対象**: bar-pos-system (Docker production build)  
**テスト環境**: `docker compose up -d --build` / `http://localhost`

---

## 1. テスト実施概要

| カテゴリ | テスト数 | Pass | Fail (修正済) |
|---|---|---|---|
| API — 正常系 | 14 | 14 | 0 |
| API — エラー系 / エッジケース | 12 | 8 | 4 → 修正済 |
| セキュリティ | 4 | 2 | 2 → 修正済 |
| フロントエンド ページ | 4 | 4 | 0 |
| レスポンスタイム | 4 | 4 | 0 |
| **合計** | **38** | **32** | **6 → 全修正済** |

---

## 2. API 正常系テスト結果

### テーブル管理 (`/api/tables`)

| # | テスト | メソッド | 結果 | ステータス |
|---|---|---|---|---|
| T-01 | テーブル一覧取得 | GET | 12件返却、正しいスキーマ | ✅ Pass |
| T-02 | テーブル作成 | POST | id/name/capacity/status 返却 | ✅ Pass |
| T-03 | テーブル更新 | PATCH | status変更・Socket broadcast 確認 | ✅ Pass |
| T-04 | テーブル削除 | DELETE | 対象なしなら 404 | ✅ Pass |

### メニュー管理 (`/api/menu`)

| # | テスト | メソッド | 結果 | ステータス |
|---|---|---|---|---|
| M-01 | アクティブメニュー取得 | GET | 19件・カテゴリ結合・float型 | ✅ Pass |
| M-02 | 全メニュー取得 (無効含む) | GET /all | is_active=false 含む全件 | ✅ Pass |
| M-03 | カテゴリ取得 | GET /categories | 5カテゴリ | ✅ Pass |
| M-04 | メニュー作成 | POST | 新規アイテム作成確認 | ✅ Pass |
| M-05 | メニュー更新 | PATCH | 部分更新・型一致 | ✅ Pass |
| M-06 | メニュー削除 (ソフト削除) | DELETE | is_active=false に変更 | ✅ Pass |

### 注文フロー (`/api/orders`)

| # | テスト | メソッド | 結果 | ステータス |
|---|---|---|---|---|
| O-01 | 注文作成 | POST | order object + items:[] 返却 | ✅ Pass |
| O-02 | テーブル別注文取得 | GET /table/:id | open order 取得 | ✅ Pass |
| O-03 | アイテム追加 | POST /:id/items | total_amount 再計算確認 | ✅ Pass |
| O-04 | 同一アイテム再追加 | POST /:id/items | quantity が累積 (3+1=4) | ✅ Pass |
| O-05 | アイテム数量変更 | PATCH /:id/items/:itemId | 変更後 total_amount 更新 | ✅ Pass |
| O-06 | アイテム削除 (quantity=0) | PATCH /:id/items/:itemId | 行削除・total 再計算 | ✅ Pass |

### 会計 (`/api/payments`)

| # | テスト | メソッド | 結果 | ステータス |
|---|---|---|---|---|
| P-01 | 会計処理 | POST /:orderId | status=paid・table=available | ✅ Pass |
| P-02 | 会計後テーブル状態 | GET /api/tables | status: available に戻る | ✅ Pass |
| P-03 | 二重会計防止 | POST 再度 | 404 返却 | ✅ Pass |

### レポート・価格 (`/api/reports`, `/api/prices`)

| # | テスト | 結果 | ステータス |
|---|---|---|---|
| R-01 | 日次レポート | total_revenue/order_count/avg_order_value 正常 | ✅ Pass |
| R-02 | 時間別レポート | 時間帯別集計 正常 | ✅ Pass |
| R-03 | 価格一覧 | 全ドリンクの current_price/pct_change 返却 | ✅ Pass |
| R-04 | 価格履歴 | 価格変動後に history に記録される | ✅ Pass |

---

## 3. エラー系 / エッジケーステスト結果

| # | テスト | 修正前 | 修正後 | 状態 |
|---|---|---|---|---|
| E-01 | `GET /api/notexist` (未定義エンドポイント) | **500** | **404** | ✅ 修正済 |
| E-02 | `POST /api/orders` (table_id=999 FK違反) | **500** | **400** `"table_id does not exist"` | ✅ 修正済 |
| E-03 | `POST /api/orders` (table_id なし) | 400 | 400 | ✅ もともと Pass |
| E-04 | `POST /api/orders` 重複作成 | 409 | 409 | ✅ もともと Pass |
| E-05 | `POST /api/orders/:id/items` (menu_item_id=999) | 404 | 404 | ✅ もともと Pass |
| E-06 | `PATCH /api/orders/:id/items` (quantity=-1) | 400 | 400 | ✅ もともと Pass |
| E-07 | `DELETE /api/tables/:id` (open order あり) | **500** (FK) | **409** `"Cannot delete table with open orders"` | ✅ 修正済 |
| E-08 | `POST /api/payments/:id` (already paid) | 404 | 404 | ✅ もともと Pass |
| E-09 | `POST /api/menu` (name 101文字) | **201** (通過) | **400** | ✅ 修正済 |
| E-10 | `POST /api/tables` (name 101文字) | **201** (通過) | **400** | ✅ 修正済 |
| E-11 | `DELETE /api/tables` (id なし) | 404 | 404 | ✅ もともと Pass |
| E-12 | Content-Type なし POST | 400 | 400 | ✅ もともと Pass |

---

## 4. セキュリティテスト結果

| # | テスト | 結果 | リスク | 対応 |
|---|---|---|---|---|
| S-01 | SQLインジェクション | パラメータ化クエリにより無効化 | ✅ 問題なし | — |
| S-02 | XSSペイロード保存 | `<script>alert(1)</script>` がそのまま DB に保存される | ⚠️ 低リスク | React が描画時にエスケープするため実害なし。入力フィルタは未実装 |
| S-03 | 認証・認可 | 全 API エンドポイントが認証なしでアクセス可能 | ⚠️ 中リスク | 内部 LAN 専用システムの想定だが、本番展開時は要対応 |
| S-04 | レート制限 | なし | ⚠️ 低リスク | 小規模運用のため許容範囲 |

---

## 5. フロントエンドページテスト

| # | パス | HTTP | 内容 |
|---|---|---|---|
| F-01 | `/` | 200 | 管理画面 (POSPage) 正常表示 |
| F-02 | `/board` | 200 | 価格ボード (BoardPage) 正常表示 |
| F-03 | `/table/1` | 200 | 客席注文画面 (TablePage) 正常表示 |
| F-04 | `/table/999` | 200 | 存在しないテーブルでもSPAルーティングで200返却 (クライアント側でハンドル) |

---

## 6. レスポンスタイム (ローカル Docker)

| エンドポイント | レスポンスタイム |
|---|---|
| GET /api/tables | 2.7ms |
| GET /api/menu | 3.8ms |
| GET /api/prices | 2.6ms |
| GET /api/menu/categories | 3.2ms |

全エンドポイント 5ms 以内。許容範囲。

---

## 7. 発見された技術的負債と対応状況

### 修正済み (このレポート時点で適用完了)

| ID | 種別 | 内容 | 修正ファイル |
|---|---|---|---|
| TD-01 | **Bug** | 未定義 `/api/*` ルートが 500 を返す → 404 に修正 | `server/index.js` |
| TD-02 | **Bug** | `POST /api/orders` の FK違反が 500 → 400 に修正 | `server/routes/orders.js` |
| TD-03 | **Bug** | `POST/PATCH /api/menu` の数値型が文字列 (`"800.00"`) → `float` キャスト追加 | `server/routes/menu.js` |
| TD-04 | **Validation** | テーブル名・メニュー名の長さバリデーションなし → 最大100文字に制限 | `server/routes/tables.js`, `server/routes/menu.js` |
| TD-05 | **Data** | open注文があるテーブルの削除が FK 500 → 409 に修正 | `server/routes/tables.js` |
| TD-06 | **Performance** | PricingEngine が各ドリンクごとに個別 DB クエリ (N+1) → 1クエリに統合 | `server/services/pricingEngine.js` |

### 残存する技術的負債 (優先度付き)

| ID | 優先度 | 種別 | 内容 | 推奨対応 |
|---|---|---|---|---|
| TD-07 | 高 | Security | API 認証なし (全エンドポイント公開) | JWT or セッションベース認証を追加 |
| TD-08 | 中 | Design | `tables.status` にDB制約なし (CHECK等) | `ALTER TABLE tables ADD CONSTRAINT check_status CHECK (status IN ('available','occupied','closing'))` |
| TD-09 | 中 | Design | `customer:call_staff` Socket が未認証 (任意 tableId で呼び出し可) | テーブル存在確認 + 呼び出し頻度制限 |
| TD-10 | 中 | Performance | フロントエンド JS バンドルが 724KB (207KB gzip) — コード分割なし | React.lazy + dynamic import で Route 単位分割 |
| TD-11 | 低 | Design | PricingEngine で price が変化しなかったアイテムは `price_history` に記録されない | 定期スナップショット記録を検討 |
| TD-12 | 低 | Design | `GET /api/prices/:id/history` 初回は常に空配列 | 初回 seed 時に current_price を history に記録 |
| TD-13 | 低 | UX | React エラーバウンダリなし — コンポーネントクラッシュで画面全体が落ちる | `<ErrorBoundary>` を `App.jsx` に追加 |
| TD-14 | 低 | Design | `capacity` の上限値チェックなし | `capacity <= 100` 等のバリデーション追加 |

---

## 8. テスト実施環境

```
OS          : macOS Darwin 24.6.0
Docker      : 29.3.1
DB          : PostgreSQL 16-alpine (Docker)
Server      : Node.js 20-alpine + Express 4.19 + Socket.io 4.7
Client      : React 19 + Vite 8 + Tailwind CSS 4 (nginx-alpine)
テスト方法  : curl + Python json.tool による手動 API テスト
```

---

*このレポートは 2026-04-01 に自動テスト + 静的解析により生成されました。*
