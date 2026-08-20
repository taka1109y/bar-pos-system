# バーPOS 価格変動・暴落システム 概要（現行=Phase7）

> 作成: 2026-08-18 ／ ブランチ: `feature/pricing-base-grid`
> 出典: `server/services/pricingModel.js`・`pricingEngine.js`・`server/routes/menu.js`・`system.js`・`CLAUDE.md` 凍結パラメータ
> 用途: Claude web との設計議論用の現状サマリ

## 0. 設計思想
- **株価ゲーム型のダイナミックプライシング**。各ドリンクの価格が注文に応じて上下する演出。
- 分析（動的価格の純増収≈0＝値上げ/値下げが相殺）を踏まえ、**系統的な底上げ**（帯中心を定価より上に置く）と**カテゴリ内の分かりやすい競争**を狙う。
- **価格は「注文イベント」でのみ動く。時間による自動増減（減衰）は無い。** 定期tickタイマーも無し（`startPricingEngine` はログのみ）。

## 1. 用語と基準
| 語 | 定義 | 備考 |
|---|---|---|
| `base_price`（定価） | 元の実売価格。**エンジンは絶対に書き換えない**（記録として不変） | DB列 |
| **pricing_base（ベースプライス＝帯の中心）** | `round_to_unit(base_price × 1.10)` | オーナー言「ベースプライス」。旧anchor統合 |
| 丸め単位 | `base<1000→¥10 ／ 1000≤base<3000→¥50 ／ base≥3000→¥100`（四捨五入） | pricing_base・step 共通 |
| **step（呼値）** | `max(¥5, floor(pricing_base × 2% / ¥5) × ¥5)` | ¥5単位で切り下げ→帯は必ず±20%以内 |

## 2. 価格格子（21点）
- 全ての約定・表示価格は格子上のみ： **`価格 = pricing_base + n × step`（n ∈ [−10, +10] の21点）**
- **ceiling（上限）** = n=+10 ＝ pricing_base + 10step（≒ +20%）
- **floor（下限）** = n=−10 ＝ pricing_base − 10step（≒ −20%）
- **実効floor（stored `min_price`）** = `max(floor, ceil_to_grid(原価 × 1.2))`
  → 原価が厳しい銘柄は下限が原価×1.2で持ち上がる（**帯下限が原価割れしない**）

## 3. 変動ロジック（シーソー＝注文契機・カテゴリ内ゼロサム）
注文が入るたびに1回発火（`runSeesaw`、`orders.js` から）：
1. **勝者** = 注文された銘柄（engine_on の変動ドリンクのみ。それ以外は無反応）
2. **上昇段 k を抽選**：`P(+1段)=0.6 / P(+2段)=0.3 / P(+3段)=0.1`（**管理画面プライシングタブで編集可**・合計1必須）
3. 勝者の上げ余地 `up = min(k, ceiling余地)`
4. **犠牲** = 同一 **top-levelカテゴリ**の他 engine_on 変動ドリンク（暴落中・時価・下限到達分は除外）。上昇分 up を**−1段ずつ抽選配分**（シャッフル→distinct優先→足りなければ下限まで重複）
5. **厳密ステップゼロサム**：勝者上昇 up ＝ 犠牲合計下降（犠牲容量が尽きたら勝者上昇も縮小）
   → カテゴリの n 合計が保存＝**平均は pricing_base（＝定価×1.10）を維持**＝底上げが効く
- qty>1 でも 1注文=1シーソー。冪等再送は不発。段ゼロサムのため円合計は厳密には保存しない（差はごく僅か・寄り付きで解消）。
- 記録イベント：`seesaw_win` / `seesaw_lose`（trigger=`order`）
- シード：テストは `SEESAW_SEED` 固定で再現。本番は `register_opened_at`＋連番＋時刻で日々変動。

## 4. 寄り付き（market open）
- **engine_enabled の非暴落ドリンクを全て pricing_base（n=0）へリセット**
- **レジオープンでは自動発火しない**（前セッションの価格を持ち越す）
- 実行は**スタッフが手動で任意のタイミング**（システム管理＞プライシング＞寄り付きリセット、`POST /api/system/market-open`、trigger=`manual`）
- 記録イベント：`market_open`

## 5. 暴落（crash）※Phase7R で深度復元
- `crash_eligible` の銘柄を **crash_floor へ即時急落**、`is_crashed=TRUE`
- **crash_floor（動的算出）＝`round_to_unit(max(原価×1.2, pricing_base×ratio))`**。ratio＝engine_on 0.5（深く）／engine_off かつ暴落可 0.7（浅め）＝`crashSettings.js`。原価欠損時は `pricing_base×ratio` のみ＋発動時警告
- **通常下限（実効floor＝stored `min_price`）とは分離**：暴落は pricing_base×比率まで深く落ち、暴落中は `current_price < min_price` が常態（原価が厳しい銘柄は 原価×1.2 で床が持ち上がる）
- **継続 5分**（`crashSettings.MANUAL_CRASH_DURATION_MS = 5 * 60 * 1000`）→ 自動解除（タイマー＋独立ウォッチャー `startCrashWatcher` の二重系）
- 復帰先＝**暴落直前の格子位置**（`price_before` を記録。stored `[min_price, max_price]` にスナップ＆クランプ。engine_off 固定品は base へ）
- スコープ＝**銘柄単位**（カテゴリはまとめて発動する指定手段）
- **約定は crash_floor 価格で通る**（約定経路 orders.js/payments.js に格子アサーションは無く current_price をそのまま unit_price へ＝暴落中の格子適用除外は自動成立）。記録イベント：`crash_manual` / `crash_reset`

## 6. 対象フラグ（menu_items）と初期割当
| フラグ | 意味 |
|---|---|
| `engine_enabled` | 自動変動の対象 |
| `crash_eligible` | 暴落の対象 |

| 区分 | engine / crash |
|---|---|
| フード・裏メニュー・時価・ノンアル・ボトル・薄利 | off / off（**常に定価**） |
| 高額グラス（base≥2000：山崎等） | off / on |
| 通常アルコール | on / on |
| **ショット＆ワイン（カテゴリ全体）** | off / off（オーナー指定・対象外） |

- 商品管理（MenuManager）でトグル編集可。deprecated `crash_enabled` は保存時に同値同期されるだけ（**読み取り禁止**）。
- `engine_enabled` を true→false にすると `current_price` は**定価（base）へ固定**。

## 7. 除外・特例
- **base=0 の時価商品（`price_editable`）はエンジン・暴落とも対象外**（常に手動価格）
- **ノンアルは常に定価**
- `price_locked`（min=max=base 完全固定）は**通常運用から除外**（障害時の緊急固定専用・UI非表示）。通常「動かさない」は `engine_enabled=false`
- **base_price 列は不変**（実売価格＝定価の記録）。markup は engine_on 変動ドリンクの帯中心にのみ効く。

## 8. 値引き費用（暴落原資）
- 集計：`Σ max(0, (注文時のbase) − 約定単価) × 数量`（`GET /api/reports/discount-cost`）。基準＝旧 `base_price`（約定時スナップ base_price_at_order 優先）で**確定**（Phase7R）
- 参考行：**純差分 `net_diff = Σ(約定単価 − base) × 数量`（負値可・値上がりを相殺した実質差）**を同 API が併記し、売上管理カードに表示
- 月次上限＝`monthly_discount_cap`（**初期¥6000→Phase7R で¥25000**・0で無効）。超過で売上管理にアラート

## 9. 運用メモ（コード外・オーナー指定）
- 取引ナイト＝**金・土 固定・週2**、**月曜定休**
- 寄り付き（価格リセット）は**スタッフ手動のみ**。**金土の営業開始時は必須（開場儀式）／平日は持ち越し容認**。管理・レジ画面に「本日の価格リセット未実施」バッジ（金土かつ未実施のみ）

## 10. イベント種別（price_events）まとめ
`seesaw_win` / `seesaw_lose`（注文シーソー）、`market_open`（寄り付き）、`crash_manual` / `crash_reset`（暴落・解除）。
※旧 `tick` / `order`（+1段）/ `decay` は廃止（コードは rollback 用に DEPRECATED 残置）。

## 11. 裁定済み事項（Phase7R・旧「未確定3件」）
1. step丸め＝**¥5採用で確定**。※現データでは step=¥15（¥5端数）が 60/86 銘柄（base 750〜900 帯）＝恒常的に発生。個別判断は保留
2. 犠牲スコープ＝**top-levelカテゴリで確定**。engine_on=1 のカテゴリ（ゼロサム不能）は**現状 0 件**。将来1銘柄化したら統合/off化を検討（監視クエリ運用）
3. 値引き費用の基準＝**旧 `base_price` で確定**（reports.js 現行維持）。参考の純差分 net_diff を併記（§8）

## 12. バックログ / 保留
- **qty>1＝1シーソー**：v1承認。初回2晩のログで再検討
- 6-6（同一原酒・提供形態違い＝1指数＋固定差額）：現メニュー該当0で保留

## 13. 主要コード参照
| 対象 | 場所 |
|---|---|
| モデル定数・格子・シーソー抽選・暴落床 | `server/services/pricingModel.js`（BASE_MARKUP / GRID_HALF_SPAN / STEP_RATE / STEP_UNIT / MARKUP_UNIT_TABLE / SEESAW_DIST・pricingBase / gridStep / priceAtN / floorPrice / ceilingPrice / effectiveFloor / **crashFloor** / drawSeesawSteps） |
| シーソー実行・寄り付き | `server/services/pricingEngine.js`（`runSeesaw` / `doMarketOpen`＝`last_market_open_at` 記録。時間減衰=`runPeriodDecay`は未使用残置） |
| 注文からの発火 | `server/routes/orders.js`（`runSeesaw(menu_item_id)`） |
| 価格帯計算・暴落発動/解除 | `server/routes/menu.js`（`computeLadder` / `/crash/manual`＝`pm.crashFloor` / crash reset / `startCrashWatcher`） |
| 暴落床の比率config・継続時間 | `server/services/crashSettings.js`（`CRASH_FLOOR_RATIO_DEFAULT` 0.5 / `_ENGINE_OFF` 0.7 / `MANUAL_CRASH_DURATION_MS`） |
| PRNG（シード可能） | `server/services/rng.js`（mulberry32＋xmur3） |
| シーソー確率の永続化・価格リセット状態API | `server/routes/system.js`（GET/PATCH `seesaw_dist`・`loadPersistedSeesawDist`・`market_reset_done`/`is_trading_night`） |
| 値引き費用・純差分 | `server/routes/reports.js`（`/discount-cost`＝`total`＋`net_diff`） |
| 移行（可逆） | `deploy/migrations/2026-08-18_pricing_base_grid_up.sql` / `_down.sql` |
