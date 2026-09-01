# 経営分析サイト（analytics/）

FANZONE POS の売上データを、店舗運営の意思決定に使える形で見るための**ローカル専用**の分析サイトです。
POS 本体（`server/` `client/`）とは別プロセス・別コンテナで動き、**POS の DB（bardb）には読み取り専用でしか触りません**。

---

## 1. 目的と原則

| 目的 | 内容 |
|------|------|
| 見る | 売上・商品・客席・損益（P&L・損益分岐点・人時生産性）・目標進捗を1つのサイトで見る |
| 入れる | POS に無い情報（経費・シフト・目標・席数・営業日ノート/タグ・レジ精算）を入力して分析に混ぜる |
| 信じる | 表示している数字が POS の集計と一致していることを、画面から実行できる検証（verify）で担保する |

守っている原則（設計上の前提なので、改修時も崩さないこと）:

1. **bardb は読み取り専用**。分析サーバは専用ロール `bar_ro` で接続し、起動時の自己診断とverifyで「書けないこと」を毎回確かめる。
2. **書き込み先は分析専用 DB（analyticsdb）だけ**。経費・シフト等の入力はすべてこちらに入り、POS の運用に影響しない。
3. **集計定義は POS 本体と共有**（`server/routes/reports.js` や `server/services/pricingModel.js` を `analytics/server/lib/posDefs.js` `lib/pricingDefs.js` 経由で参照）。定義を二重に書かない。
4. **ローカル専用**。Web は `127.0.0.1:8080` にだけ公開し、LAN にも本番 Pi にも出さない。
5. **本番には触らない**。本番データは「取り込む（ダンプを読む）」だけで、本番への書き込み・接続はしない。

---

## 2. 構成

```
                         ┌──────────────────────────────────────────┐
  ブラウザ                │  bar-analytics-web  (nginx)              │
  http://127.0.0.1:8080 ─▶│   ・SPA(React/Vite ビルド成果物)を配信    │
                         │   ・/api/       → analytics-server:3101   │
                         │   ・/api/legacy/ は GET/HEAD のみ許可      │
                         └───────────────┬──────────────────────────┘
                                         │
                         ┌───────────────▼──────────────────────────┐
                         │  bar-analytics-server  (Node/Express)    │
                         │   ・/api/v1/...    分析API(営業日集計等)   │
                         │   ・/api/legacy/... POS の reports/logs   │
                         │     をそのまま読み取り専用で再利用         │
                         └───┬───────────────────────┬──────────────┘
              読み取り専用    │                       │  読み書き
              (ロール bar_ro) │                       │
        ┌────────────────────▼──────┐   ┌────────────▼─────────────────┐
        │  bar-pos-postgres / bardb │   │ bar-analytics-postgres        │
        │  ※ POS 本体と共有(既存)    │   │ / analyticsdb                 │
        │  会計・注文・商品・価格     │   │ 経費/シフト/目標/席数/タグ/    │
        │                           │   │ 取込記録/検証結果             │
        └───────────────────────────┘   └───────────────────────────────┘
```

- コンテナは3つ（`bar-analytics-web` / `bar-analytics-server` / `bar-analytics-postgres`）。
  いずれも `docker-compose.analytics.yml` の `profiles: ["analytics"]` に入っているので、
  **素の `docker compose up` では起動しません**（本番 Pi の構成には影響しない）。
- `bar-pos-postgres` は既存 POS のものを**共有**します（分析用に別インスタンスは立てない）。
  そのため分析スタックの操作では、既存 POS の3コンテナ（postgres / server / client）を停止・再作成しません。

必要な `.env`（リポジトリ root。値は URL に埋め込むため英数字のみ推奨）:

| キー | 用途 |
|------|------|
| `ANALYTICS_DB_PASSWORD` | 分析 DB（analyticsdb / ユーザー `analytics`）のパスワード |
| `BARDB_RO_PASSWORD` | bardb 読み取り専用ロール `bar_ro` のパスワード（`ana.sh grant` が設定する） |

---

## 3. 起動・停止

すべて `analytics/bin/ana.sh` から操作します（`docker compose` を直接叩くと、`--profile` や `-f` の付け忘れで
既存 POS スタックを巻き込む事故につながるため）。

```bash
# 通常起動（ビルド → bar_ro 付与 → 3コンテナ起動 → health 確認）
./analytics/bin/ana.sh up
# → http://127.0.0.1:8080

# 開発（サーバはホットリロード、フロントは Vite dev サーバ）
./analytics/bin/ana.sh dev
npm install --prefix analytics/client   # 初回のみ
npm run dev --prefix analytics/client   # http://127.0.0.1:5174 （/api → 127.0.0.1:3101）

# 状態確認・ログ
./analytics/bin/ana.sh ps
./analytics/bin/ana.sh logs analytics-server

# 停止（分析3サービスだけ。analyticsdb のボリュームは残る）
./analytics/bin/ana.sh down
```

- `up` は事前に `bar-pos-postgres` が稼働していること、および compose 設定ハッシュが一致することを確認します
  （不一致のまま `up` すると依存先の postgres が再作成されてしまうため、その場合は中止します）。
- `up` は起動前に必ず `grant`（`bar_ro` の作成・SELECT 付与）を実行します。権限が無いと分析サーバは
  自己診断で終了し、`restart: unless-stopped` により再起動を繰り返します。
- **`docker compose down -v` は絶対に使わないこと**（analyticsdb＝入力データを失います）。

サーバ起動時に `analytics/db/migrations/` の未適用マイグレーションが自動適用されます（`db/migrate.js`）。
手動で扱う場合:

```bash
docker exec bar-analytics-server node db/migrate.js status
docker exec bar-analytics-server node db/migrate.js up
docker exec bar-analytics-server node db/migrate.js down 0003   # 最新のものだけ戻せる
```

---

## 4. 本番データの取込（`ana.sh refresh`）

分析はローカルの `bardb` を見ます。中身を**本番の最新スナップショットで置き換える**のが `refresh` です。

```bash
./analytics/bin/ana.sh refresh
```

流れ:

1. 確認プロンプト（`ANA_YES=1` で省略可）
2. `analyticsdb` を `backups/analytics/` へ pg_dump（入力データの退避）
3. `analytics-server` を停止（bardb 置換中に `bar_ro` の接続を残さない）
4. `deploy/fetch-prod-snapshot.sh` を**無改変で**実行
   （本番 Pi から `pg_dump` を取得 → ローカル `bardb` を退避 → 置換 → 件数照合）
5. `grant`（bardb を作り直したので `bar_ro` の権限を再付与）
6. `analytics-server` を起動し health 確認
7. 取込を記録（`POST /api/v1/meta/sync {dump_file}`）— 画面の「データ基準」バナーはこの記録を表示します
8. `verify`（整合性チェック）を実行し、FAIL があれば異常終了

安全性:

- **本番へは読み取りのみ**（`pg_dump` のみ。本番の DB・アプリは変更しません）。
- 破壊的なのは**ローカルの bardb** です。置換前に `backups/local_before_prod_<ts>.sql` へ退避されます。
- 途中で失敗した場合は後始末（grant 再付与 → サーバ起動 → 状態確認）を行い、
  「どの段階で失敗したか・bardb は無事か・復旧コマンド」を表示して終了します。表示された手順に従ってください。
- 取込直後は必ず `verify` が走ります。ここが PASS して初めて「本番と同じ数字を見ている」と言えます。

---

## 5. バックアップ・復元（analyticsdb）

経費・シフト・目標などの**入力データはローカルにしかありません**。定期的に退避してください。

```bash
# 退避（backups/analytics/analyticsdb_YYYYMMDD_HHMMSS.sql）
./analytics/bin/ana.sh backup

# 復元（実行前に現状を自動 backup し、確認プロンプトあり）
./analytics/bin/ana.sh restore backups/analytics/analyticsdb_20260901_120000.sql
```

- `backup` はダンプ末尾の完了マーカーを確認します（不完全なダンプはエラーにします）。
- `restore` は analyticsdb の public スキーマを作り直してから流し込みます（`analytics-server` は自動で停止・再開）。
- `backups/` は `.gitignore` 済みです（コミットしないこと）。

---

## 6. 検証（`ana.sh verify` / 画面「データ ＞ 同期・検証」）

`POST /api/v1/meta/verify` が下の11項目を順に実行し、結果を `verification_runs` に記録します。
1件でも FAIL なら `ana.sh verify` は異常終了し、全画面上部の「データ基準」バナーが警告表示に変わります。

| チェック | 何を確かめているか | FAIL のときに疑うこと |
|----------|-------------------|----------------------|
| `readonly_role` | 分析サーバが `bar_ro` で、読み取り専用セッションとして bardb に接続できている | 接続情報・ロールの消失 |
| `readonly_enforced` | 素の接続で `CREATE TEMP TABLE` が read-only エラー（25006）になる＝本当に書けない | ロールに余計な権限が付いた |
| `legacy_reachable` | 直近30日の `/api/legacy/reports/analytics` の売上が、共有定義（`posDefs`）の集計と一致する | 定義の取り違え・legacy 経路の故障 |
| `snapshot_recorded` | 取込記録（`snapshot_imports`）の件数と、現在の bardb の件数が一致する | 取込後に bardb が変わった（＝ドリフト。`ana.sh refresh` か sync 記録のやり直し） |
| `schema_ok` | analyticsdb のマイグレーションが適用済み | マイグレーション未適用・DB 初期化直後 |
| `legacy_match_summary` | 直近7日/今月/全期間の summary（売上・原価・粗利・会計数・客数・平均滞在）が legacy と一致（暦日ベースで比較） | 集計 SQL の変更ミス |
| `legacy_match_daily` | 全期間の日次（売上・原価・粗利）が legacy の profit-summary と日単位で一致 | 日付境界・欠損日の扱い |
| `conservation` | 「営業日で合計」＝「暦日で合計」＝「範囲フィルタ無しの直接 SUM」（保存則） | 期間バケットからの漏れ・二重計上 |
| `boundary_zero` | 境界時刻 0 時の営業日集計が、暦日集計と完全一致する | 営業日変換の実装ミス |
| `delta_check` | 直近14日で `business(D) = calendar(D) − late(D) + late(D+1)`（`late` = 0時〜境界時刻の会計） | 営業日シフトの向き・時差 |
| `legacy_match_discount_cost` | `/api/v1/pricing/effect` の値引き費用（`total` / `net_diff` / `month_total` と日次内訳）が `/api/legacy/reports/discount-cost` と一致（暦日ベースで比較） | 値引き費用の定義がずれた・`base_price_at_order` の扱いの変更 |

`GET /api/v1/meta/verify/latest` が最新結果、`GET /api/v1/meta/health` が稼働状態
（bardb 自己診断・適用済みマイグレーション）を返します。

---

## 7. 営業日境界の考え方

深夜営業の店なので、「暦日」で切ると1晩の売上が2日に割れてしまいます。そこで**営業日**を使います。

- 営業日 = **境界時刻（`store_settings.business_day_boundary_hour`、既定 9:00）より前の時刻は前日扱い**にした日付。
  例: 境界 9 時のとき、8/30 03:00 の会計は営業日 **8/29**。
- 画面の期間バーの「日付の基準」で `営業日 / 暦日` を切り替えられます（URL クエリ `day_mode` に入るので共有可）。
- 時間帯の軸は **32時間表記**（17〜29時。29時 = 翌朝5時）を使い、1晩が途切れないようにしています。
- 実装は `analytics/server/lib/businessDay.js` に集約（SQL 式生成と JS 側の日付計算の両方）。
  タイムゾーンは `TZ_REPORT`（既定 `Asia/Tokyo`）で、POS 本体の `server/utils/time.js` と同じ定義です。
- 境界時刻は「データ ＞ 店舗設定」で変更できます。**変更すると過去の集計結果も変わります**（データは書き換わりません）。
- 例外: 滞在時間・席稼働は即会計テーブルを除外、`legacy_*` の検証は暦日ベースで比較、など
  個別の定義は各 API の応答 `meta.note` に必ず書いてあります。

---

## 8. 画面一覧

| グループ | 画面 | パス | 内容 |
|---------|------|------|------|
| — | ダッシュボード | `/` | KPI（売上・粗利・客数・客単価・会計件数／営業利益・営業利益率・人件費率・目標達成率）、日次売上×粗利率、支払方法、曜日×時間帯、入力アラート |
| 売上分析 | 推移 | `/sales/trend` | 日/週/月/年度の推移・前期間比較・CSV |
| 売上分析 | 曜日×時間帯 | `/sales/time` | ヒートマップ・曜日別・時間帯別（32時間表記） |
| 売上分析 | カレンダー | `/sales/calendar` | 月次カレンダー（売上の濃淡・タグ・天候） |
| 売上分析 | 支払・税・取消 | `/sales/payments` | 支払方法別・税率別・割引/取消（赤黒伝票） |
| 売上分析 | 期間比較 | `/sales/compare` | 任意の期間A/Bの並列比較 |
| 商品分析 | ランキング&ABC | `/products/ranking` | 売上/数量/粗利ランキング・パレート図 |
| 商品分析 | メニューミックス | `/products/mix` | カテゴリ・小分類・ドリンク/フード等の構成比 |
| 商品分析 | 商品推移 | `/products/trend` | 最大10商品の推移比較 |
| 商品分析 | 併売分析 | `/products/affinity` | 同時に注文される組み合わせ |
| 商品分析 | メニュー分析 | `/products/engineering` | 人気×粗利の4象限 |
| 客席分析 | 客数・客単価 | `/seats/guests` | 組人数分布・客単価分布 |
| 客席分析 | 席稼働・回転 | `/seats/utilization` | 卓別の稼働率・回転数・タイムライン |
| 客席分析 | 滞在時間 | `/seats/stay` | 滞在時間の分布 |
| 比較 | タグ・天候別 | `/compare/tags` | タグの有無・天候別の売上比較 |
| 目標 | 目標管理 | `/targets` | 月次目標の入力と進捗（着地予測・残り日割） |
| 損益 | 月次P&L | `/pl/statement` | 売上→営業利益のウォーターフォールと科目×期間表（**印刷対応**） |
| 損益 | 損益分岐点 | `/pl/breakeven` | BEP 図・必要売上・安全余裕率 |
| 損益 | 人時生産性 | `/pl/labor` | 人時売上・人時粗利・スタッフ別・時間帯別 |
| 価格変動 | 価格効果 | `/pricing/effect` | 定価比バンド別の販売数量・売上、値引き費用（暴落原資）と純差分、月次上限の使用率（**印刷対応**） |
| 価格変動 | 暴落分析 | `/pricing/crash` | 暴落区間ごとの売れ行きと、直近4週の同曜日・同時間帯との比較（増減率）、暴落銘柄の明細（**印刷対応**） |
| 価格変動 | シーソー分析 | `/pricing/seesaw` | 勝ち（上昇）／負け（下降）の回数・段数分布・銘柄別の差引段数、寄り付き（価格リセット）の実施記録（**印刷対応**） |
| 入力 | 営業日ノート・タグ | `/inputs/days` | 天候・メモ・タグ付け |
| 入力 | 席数 | `/inputs/seats` | 卓ごとの席数（稼働率の分母） |
| 入力 | レジ精算 | `/inputs/closings` | 現金過不足の記録 |
| 入力 | 経費 | `/inputs/expenses` | 経費入力・科目管理・CSV 取込 |
| 入力 | 定期経費 | `/inputs/recurring` | 毎月の自動計上（冪等） |
| 入力 | スタッフ・シフト | `/inputs/shifts` | スタッフ・時給・シフト（人件費の元データ） |
| 設定 | 店舗設定 | `/settings-store` | 営業日境界・週開始・年度開始月・ABC 閾値・オーナー人件費の扱い |
| データ | 同期・検証 | `/data` | 取込状況・verify の実行と結果 |

- ダッシュボード・推移・月次P&L・価格変動の3画面には**「印刷」ボタン**があります。押すとブラウザの印刷ダイアログが開き、
  サイドバー・期間バー・ボタンを除いた「紙向けの体裁」で出ます（`client/src/index.css` の `@media print`）。
- 価格変動の3画面は Phase 5 で追加したもので、いずれも POS の Phase7 価格モデル（`server/services/pricingModel.js` の
  凍結パラメータ）を前提にしています。呼値（1段の値幅）と暴落の既定継続時間は分析側で定義を持たず、
  `analytics/server/lib/pricingDefs.js` が本番のモデルをそのまま `require` して使います。

---

## 9. API とデータの置き場所

| 経路 | 中身 |
|------|------|
| `/api/v1/...` | 分析サイト固有 API。営業日/暦日・粒度・比較に対応し、応答に必ず `meta`（定義バージョン・TZ・境界時刻・スナップショット・`note`）が付く |
| `/api/legacy/...` | POS 本体の `server/routes/reports.js` `logs.js` をそのまま読み取り専用でマウント（暦日・JST 集計）。**GET/HEAD 以外は nginx とサーバの両方で拒否** |

- 入力データ（analyticsdb）: `store_settings` / `seat_capacities` / `business_days` / `business_day_tags` / `tags` /
  `targets` / `register_closings` / `expense_categories` / `expenses` / `recurring_expenses` /
  `staff` / `staff_wage_history` / `shifts` / `snapshot_imports` / `verification_runs` / `schema_migrations`
- 時給は**シフト登録時に `hourly_wage_snapshot` へ確定**します。後から時給を改定しても過去のシフトの人件費は変わりません。
  スタッフ作成時に「全期間の初期時給」を `staff_wage_history` に入れているため、
  改定後に過去日のシフトを登録しても**改定前の時給**が付きます（マイグレーション `0003`）。
- 価格変動 API（`/api/v1/pricing/effect` `/crash-windows` `/seesaw`）は bardb の `price_events` と
  `order_items` だけを読みます。値引き費用は `/api/legacy/reports/discount-cost` と**同一定義**で、
  一致は verify の `legacy_match_discount_cost` が保証します（不一致になったら定義がずれた合図）。
- CSV 出力は各画面の「CSV」ボタン（`GET /api/v1/export/csv?report=...`、BOM 付き）。
  Phase 5 で `pricing_bands` / `crash_windows` / `seesaw` を追加しました。

---

## 10. 性能

主要12エンドポイントの応答時間（**全期間 `start=2026-07-01&end=2026-09-01`・各5回**の p50 / p95、単位 ms）。
計測は `curl -w '%{time_total}'` で nginx（`http://127.0.0.1:8080`）越しに測った実測値です。

| エンドポイント | p50 | p95 | 応答サイズ |
|----------------|----:|----:|----------:|
| `GET /api/v1/sales/summary` | 30.4 | 67.7 | 0.7 KB |
| `GET /api/v1/sales/trend?granularity=day` | 19.3 | 26.3 | 12.9 KB |
| `GET /api/v1/sales/heatmap` | 20.0 | 31.3 | 5.9 KB |
| `GET /api/v1/products/ranking` | 22.7 | 26.9 | 59.6 KB |
| `GET /api/v1/products/affinity` | 29.0 | 45.2 | 17.2 KB |
| `GET /api/v1/seats/utilization` | 10.2 | 10.8 | 3.1 KB |
| `GET /api/v1/pl/statement?granularity=month` | 17.1 | 25.5 | 3.0 KB |
| `GET /api/v1/labor/productivity?granularity=month` | 26.8 | 86.6 | 3.5 KB |
| `GET /api/v1/pricing/effect` | 25.1 | 36.1 | 6.6 KB |
| `GET /api/v1/pricing/crash-windows` | 31.1 | 153.1 | 2.9 KB |
| `GET /api/v1/pricing/seesaw` | 13.5 | 65.5 | 3.8 KB |
| `GET /api/legacy/reports/analytics` | 114.6 | 138.0 | 31.6 KB |

計測時点のデータ量: `orders` 199 件（`paid`、2026-07-10〜08-29）／全期間 63 日。

**結果: 500ms 超はゼロ**（最大は `pricing/crash-windows` の p95 = 153.1ms）。最適化は不要と判断し、
SQL・JS には手を入れていません。

読み方と注意:

- **p95 は n=5 の最近傍順位法なので実質「5回中の最大値」**です。Node のJIT・pg の接続再利用・OSのページ
  キャッシュの影響で初回だけ跳ねるため、p50 と p95 の差はほぼ「ウォームアップ差」だと考えてください
  （`crash-windows` の p50 31ms / p95 153ms がその典型）。
- `pricing/crash-windows` は区間ごとに `unnest(...) WITH ORDINALITY` + `LATERAL` で
  「区間内」「暴落銘柄のみ」「参照4週」を3本並列に引くため、この12本の中では最も重い作りです。
  暴落の打数が増えると区間数に比例して伸びるので、**将来 500ms を超えたらまずここ**を見てください
  （`MAX_CRASH_WINDOWS = 500` で件数上限は掛かっています）。
- `legacy/reports/analytics` が最も遅いのは、本番 `server/routes/reports.js` をそのまま読んでいるためです。
  分析サイト側では最適化しません（本番と数字が食い違う原因になるため、定義もSQLも触らない方針）。

改善が必要になった場合の方針: `EXPLAIN` で原因を確認し、**JS 側（SQL の1本化・不要な JOIN の削減）で改善する**。
**bardb への索引追加は禁止**（本番 POS と同じ DB を共有しており、本番に影響するため）。

再計測の手順:

```bash
B=http://127.0.0.1:8080; P='start=2026-07-01&end=2026-09-01'
for i in 1 2 3 4 5; do curl -s -o /dev/null -w '%{time_total}\n' "$B/api/v1/pricing/effect?$P"; done
```

---

## 11. トラブルシュート

| 症状 | 対処 |
|------|------|
| `analytics-server` が起動と終了を繰り返す | ほぼ `bar_ro` の権限切れ（bardb を作り直した後など）。`./analytics/bin/ana.sh grant` → `docker compose -f docker-compose.yml -f docker-compose.analytics.yml --profile analytics start analytics-server` |
| verify の `readonly_role` / `readonly_enforced` が FAIL | 同上（`grant` は冪等なので何度でも実行可）。`readonly_enforced` だけ FAIL なら `bar_ro` に書き込み権限が付いてしまっている |
| バナーが「取込記録と現在の件数が一致しません」 | bardb が取込後に変わっている。`ana.sh refresh` で取り直すか、意図した状態なら「データ ＞ 同期・検証」で取込を記録し直す |
| `up` が「postgres の compose 設定が稼働中コンテナと異なります」で中止 | そのまま進むと既存 POS の postgres が再作成される。`docker-compose.yml` の差分を確認してから対応する（分析側で回避しない） |
| 画面は出るがデータが空 | 期間が本番スナップショットの範囲外。バナーの「最終会計」日時を見て期間を合わせる |
| 経費・シフトが消えた | analyticsdb のボリュームを消したか、`down -v` を実行した可能性。`ana.sh restore <backup>` で戻す |
| `ana.sh` が「jq が必要です」 | `brew install jq` |
| ポート 8080 が使えない | 他プロセスと衝突。`docker-compose.analytics.yml` の `analytics-web` の公開ポートを変更する（`127.0.0.1` 束縛は外さない） |
| 印刷すると1画面分しか出ない | `@media print` が効いていない（ビルドが古い）。`ana.sh up` で `analytics-web` を作り直す |

---

## 12. 公開リポジトリでの注意

このリポジトリを公開・共有する場合:

- **`.env` は絶対にコミットしない**（`ANALYTICS_DB_PASSWORD` / `BARDB_RO_PASSWORD` を含む）。テンプレートは `.env.example`。
- `backups/`・`analytics/exports/`・`analytics/**/*.csv` は `.gitignore` 済み。
  **実データ（会計ダンプ・売上 CSV・スナップショット）をコミットしない**こと。
- 本番 Pi の**ホスト名・IP・SSH ユーザー・鍵**をドキュメントやコード、コミットメッセージに書かない
  （接続情報は `deploy/` のスクリプトが参照する環境変数側に置く）。
- スクリーンショットを貼る場合、売上額・スタッフ名・時給が写り込んでいないか確認する。
- この分析サイトは**ローカル専用**です。公開サーバや LAN に出す前提の認証・認可は入っていません
  （`127.0.0.1` 束縛が唯一のアクセス制御）。外に出すなら認証の設計からやり直すこと。
