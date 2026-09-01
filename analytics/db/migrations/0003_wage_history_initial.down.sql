-- 0003_wage_history_initial の rollback: 補完した初期行（effective_from = '1900-01-01'）を削除する。
-- ※ up 適用後に POST /api/v1/staff が作成した初期行も同じ日付なので併せて消える。
--   これは「履歴が全期間をカバーしない＝遡及バグのある状態」へ戻すという意味で意図どおりの巻き戻し。
--   実シフトの hourly_wage_snapshot は登録時に確定済みなので、この削除でも過去の人件費は変わらない。
DELETE FROM staff_wage_history WHERE effective_from = DATE '1900-01-01';
