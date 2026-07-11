import { useState } from 'react';
import { api } from '../../api';
import Section from './Section';

export default function MaintenanceTab() {
  const [archiveConfirm, setArchiveConfirm] = useState(false);
  const [archiveResult,  setArchiveResult]  = useState(null);
  const [archiveError,   setArchiveError]   = useState(null);
  const [archivePending, setArchivePending] = useState(false);

  return (
    <Section title="データアーカイブ" desc="90日以前の会計済みデータを削除してDB容量を削減します。実行前に伝票一覧PDFを出力し、NASへ保存してください。">
      <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg mb-6">
        <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>
        <div className="text-sm">
          <p className="font-semibold mb-1">実行前に必ず確認してください</p>
          <p>伝票情報ページから伝票一覧PDFを出力し、NASへ保存してから実行してください。削除したデータは復元できません。</p>
        </div>
      </div>
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <p className="text-sm text-slate-600 mb-1">削除対象：<span className="font-semibold text-slate-900">90日以前</span>の会計済みデータ（注文・明細）</p>
        <p className="text-xs text-slate-400 mb-4">メニュー・テーブル設定は削除されません</p>
        {archiveResult && (
          <div className="flex items-start gap-3 p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg mb-4 text-sm">
            アーカイブ完了：注文 {archiveResult.deleted_orders} 件・明細 {archiveResult.deleted_items} 件を削除しました
          </div>
        )}
        {archiveError && (
          <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg mb-4 text-sm">
            エラー: {archiveError}
          </div>
        )}
        {!archiveConfirm ? (
          <button
            onClick={() => { setArchiveConfirm(true); setArchiveResult(null); setArchiveError(null); }}
            className="inline-flex items-center justify-center gap-2 h-10 px-4 text-sm font-semibold bg-red-600 hover:bg-red-700 text-white rounded-lg cursor-pointer transition-colors"
          >
            アーカイブ実行
          </button>
        ) : (
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-600">PDF保存済みですか？削除後は復元できません。</span>
            <button
              onClick={() => setArchiveConfirm(false)}
              className="inline-flex items-center justify-center h-11 px-3 text-sm bg-white text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
            >
              キャンセル
            </button>
            <button
              disabled={archivePending}
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
              }}
              className="inline-flex items-center justify-center h-11 px-4 text-sm font-semibold bg-red-600 hover:bg-red-700 text-white rounded-lg cursor-pointer disabled:opacity-50"
            >
              {archivePending ? '実行中...' : '削除を確定'}
            </button>
          </div>
        )}
      </div>
    </Section>
  );
}
