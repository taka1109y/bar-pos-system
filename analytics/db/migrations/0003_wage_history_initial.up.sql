-- 0003_wage_history_initial: 時給履歴に「初期行」を補完し、時給改定の遡及バグを解消する
--（Phase 4 の申し送り事項 = 改定後に過去日のシフトを登録すると改定後の時給が付いてしまう問題）
--
-- 背景:
--   routes/staff.js の resolveWage() は staff_wage_history の
--   「effective_from <= 対象営業日 の最新」を採り、無ければ staff.hourly_wage（＝現在値）へ
--   フォールバックする。時給改定（PATCH /api/v1/staff/:id）は「改定日から有効」として履歴を積むので、
--   改定日より前の営業日は履歴でカバーされず、フォールバックで「改定後の時給」が付いていた。
--
-- 対策:
--   すべてのスタッフに effective_from = '1900-01-01' の初期行を1件持たせ、
--   履歴が常に全期間をカバーしている状態にする（resolveWage のフォールバックは理論上到達しなくなる）。
--   これ以降に作られるスタッフは POST /api/v1/staff が同じ初期行を同一トランザクションで入れる。
--
-- 補完する時給の決め方:
--   ・履歴がある     → その最古行の hourly_wage
--     （改定前の実額はどこにも記録が無いため、時間的に最も近い既知の値を採る。
--       現在値を使うと「最後の改定後の時給」が全期間に遡ってしまい、バグの再現になる）
--   ・履歴が無い     → staff.hourly_wage（現在値。改定が一度も無い＝全期間この値）
--   ※ 既存シフトの hourly_wage_snapshot は登録時に確定済みで、この補完では一切変化しない。
--
-- 冪等: 1900-01-01 以前をカバーする行が既にあるスタッフは対象外（NOT EXISTS）＋ ON CONFLICT DO NOTHING
-- 可逆: 0003_wage_history_initial.down.sql が補完行（effective_from='1900-01-01'）を削除する

INSERT INTO staff_wage_history (staff_id, effective_from, hourly_wage)
SELECT s.id,
       DATE '1900-01-01',
       COALESCE(
         (SELECT w.hourly_wage
          FROM staff_wage_history w
          WHERE w.staff_id = s.id
          ORDER BY w.effective_from
          LIMIT 1),
         s.hourly_wage
       )
FROM staff s
WHERE NOT EXISTS (
  SELECT 1 FROM staff_wage_history w0
  WHERE w0.staff_id = s.id AND w0.effective_from <= DATE '1900-01-01'
)
ON CONFLICT (staff_id, effective_from) DO NOTHING;
