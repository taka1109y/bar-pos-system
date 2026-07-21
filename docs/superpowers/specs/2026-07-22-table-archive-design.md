# テーブルのアーカイブ（非表示）化 設計

作成日: 2026-07-22

## Context（背景・目的）
不要になったテーブルを削除しようとしても、そのテーブルに会計済み（`paid`）の売上履歴があるとアプリが削除をブロックする（`server/routes/tables.js` の DELETE が 409 "Cannot delete table with order history" を返す）。これは `orders.table_id` FK と帳簿整合性を守るための意図的な仕様。しかし運用上、テスト用・季節用など不要になったテーブルを画面から消せず、その都度DBを手動操作（履歴オーダーの付け替え＋テーブル物理削除）する必要があり手間とリスクが大きい。

本変更で、既存の `menu_items.is_active` と同じ**ソフト削除（アーカイブ）パターン**をテーブルに導入し、売上履歴を保持したままテーブルをレジ・お客さん画面から非表示にできるようにする。誤操作時は復元も可能にする。

## スコープ外
- テーブルの並び替え/カテゴリ化などの機能追加はしない。
- 即会計テーブル（`table_type='immediate'`）の扱いは現状維持（`GET /` は従来どおり除外）。

## データ構造
`tables` に列を追加（`server/db/schema.sql`、`menu_items` と同じ `ADD COLUMN IF NOT EXISTS` マイグレーション方式）:
```sql
ALTER TABLE tables ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
```
売上履歴（`orders`）は一切変更しない。アーカイブは `is_active=FALSE` で表現。

## サーバ（`server/routes/tables.js`）
1. **`GET /`**: 既定で `is_active = TRUE` のみ返す（`WHERE table_type != 'immediate' AND is_active = TRUE`）。クエリ `?include_archived=true` の時のみ全件返し、レスポンスに `is_active` を含める。返却カラムに `is_active` を追加する。
2. **`DELETE /:id`** を分岐（上から順に評価）:
   - オープン注文あり（`status='open'`）→ 従来どおり **409**（削除不可）。
   - 売上履歴あり（`orders` に1件以上）→ ハード削除せず **`is_active=FALSE` に更新（アーカイブ）**、`{ ok: true, archived: true }` を返す。
   - 履歴なし → 従来どおり **物理削除**、`{ ok: true, deleted: true }` を返す。
3. **`PATCH /:id`**: `is_active`（boolean）を受け付け、指定時は更新対象に加える（復元＝`true`）。既存の name/table_type/status 更新ロジックはそのまま。
4. アーカイブ／復元／物理削除の各成功時に `broadcast('tables:changed', {})` を発行し、他端末のレジ画面を更新可能にする。

## クライアント
### `client/src/api.js`
- `getTables()` は既定のまま（active のみ）。管理用に `getTables({ includeArchived: true })` 相当を追加（`/tables?include_archived=true`）。既存呼び出し（POSPage/TablePage/TableSelectPage）は引数なしのまま active のみ取得＝アーカイブ済みは自動的に非表示。

### `client/src/components/tables/TableManager.jsx`
- 一覧取得を `include_archived=true` に切替え、`is_active=false` の行は通常セクションから除外し、**「アーカイブ済み」折りたたみセクション**にまとめて表示。
- 削除ボタン押下時のフロー:
  - `status !== 'available'` は従来どおりローカルで弾く（使用中は不可）。
  - 確認ダイアログ文言を実態に合わせる。削除実行後、レスポンスの `archived`/`deleted` に応じてトースト/メッセージ表示（「非表示にしました（売上履歴のため保持）」／「削除しました」）。
- アーカイブ済み行には **「復元」ボタン**（`updateTable(id, { is_active: true })`）を表示。
- `tables:changed` socket を購読して一覧を invalidate（任意だが他端末反映のため推奨）。

## エラーハンドリング
- オープン注文があるテーブルの削除は 409 のまま。クライアントは既存の `onError` でメッセージ表示。
- `PATCH` の `is_active` は boolean 以外を無視（バリデーション）。

## テスト（手動・end-to-end）
ローカル Docker（`docker compose up -d --build`）で:
1. **マイグレーション**: サーバ再起動後 `tables.is_active` 列が存在し既存行が全て `TRUE`。
2. **履歴ありテーブルのアーカイブ**: 売上履歴のあるテーブルを管理画面で削除→物理削除されず「アーカイブ済み」へ移動。レジ画面・お客さん画面（`/table/:id` 一覧）から消える。売上集計（`/analytics` 等）が不変。
3. **復元**: アーカイブ済みから「復元」→通常セクションへ戻り、レジ画面に再表示。
4. **履歴なしテーブルの物理削除**: 新規作成→即削除で従来どおりDBから消える。
5. **使用中テーブル**: オープン注文中のテーブル削除は 409 で弾かれる。
6. 本番反映は `git push` → Pi で `git pull` →（DBマイグレーションは server 起動時に走るため）`docker compose up -d --build --no-deps server client`。デプロイ前に pre_deploy バックアップを取得。

## 影響ファイル
- `server/db/schema.sql`（列追加）
- `server/routes/tables.js`（GET/DELETE/PATCH）
- `client/src/api.js`（include_archived 対応）
- `client/src/components/tables/TableManager.jsx`（アーカイブ表示・復元）
