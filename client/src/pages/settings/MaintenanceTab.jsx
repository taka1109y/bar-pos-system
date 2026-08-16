import { useState } from 'react';
import { api } from '../../api';
import Section from './Section';
import { Button, Alert } from '../../components/ui';

export default function MaintenanceTab() {
  const [archiveConfirm, setArchiveConfirm] = useState(false);
  const [archiveResult,  setArchiveResult]  = useState(null);
  const [archiveError,   setArchiveError]   = useState(null);
  const [archivePending, setArchivePending] = useState(false);

  return (
    <Section title="データアーカイブ" desc="90日以前の会計済みデータを削除してDB容量を削減します。実行前に伝票一覧PDFを出力し、NASへ保存してください。">
      <Alert tone="warning" title="実行前に必ず確認してください" className="mb-5">
        伝票情報ページから伝票一覧PDFを出力し、NASへ保存してから実行してください。削除したデータは復元できません。
      </Alert>
      <div className="bg-surface border border-line rounded-xl p-4">
        <p className="text-sm text-body mb-1">削除対象：<span className="font-semibold text-heading">90日以前</span>の会計済みデータ（注文・明細）</p>
        <p className="text-xs text-muted mb-4">メニュー・テーブル設定は削除されません</p>
        {archiveResult && (
          <Alert tone="success" className="mb-4">アーカイブ完了：注文 {archiveResult.deleted_orders} 件・明細 {archiveResult.deleted_items} 件を削除しました</Alert>
        )}
        {archiveError && <Alert tone="danger" className="mb-4">エラー: {archiveError}</Alert>}
        {!archiveConfirm ? (
          <Button variant="danger" onClick={() => { setArchiveConfirm(true); setArchiveResult(null); setArchiveError(null); }}>アーカイブ実行</Button>
        ) : (
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm text-body">PDF保存済みですか？削除後は復元できません。</span>
            <Button variant="secondary" onClick={() => setArchiveConfirm(false)}>キャンセル</Button>
            <Button variant="danger" loading={archivePending}
              onClick={async () => {
                setArchivePending(true);
                setArchiveError(null);
                try {
                  const result = await api.archiveOldData(90);
                  setArchiveResult(result);
                  setArchiveConfirm(false);
                } catch (e) {
                  setArchiveError(e.message);
                } finally {
                  setArchivePending(false);
                }
              }}>
              削除を確定
            </Button>
          </div>
        )}
      </div>
    </Section>
  );
}
