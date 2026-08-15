import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import Section from './Section';

function fmtElapsed(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function fmtStartTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

export default function CrashTab() {
  const queryClient = useQueryClient();

  const { data: settings }           = useQuery({ queryKey: ['system-settings'], queryFn: api.getSystemSettings });
  const { data: categories    = [] } = useQuery({ queryKey: ['categories-staff'], queryFn: api.getStaffCategories });
  const { data: menuItems     = [] } = useQuery({ queryKey: ['menu-all'], queryFn: api.getAllMenu });

  const [resetMsg,       setResetMsg]       = useState('');
  const [elapsed,        setElapsed]        = useState(0);
  // 手動暴落(フェーズ3)
  const [manualScope,    setManualScope]    = useState('all'); // 'all' | 'category'
  const [manualCatIds,   setManualCatIds]   = useState([]);
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [manualMsg,      setManualMsg]      = useState('');

  // 暴落中アイテムからアクティブ状態・対象カテゴリを導出
  const crashedItems      = menuItems.filter((i) => i.is_crashed && i.is_active);
  const isCrashActive     = crashedItems.length > 0;
  const crashedCatIds     = [...new Set(crashedItems.map((i) => i.category_id))];
  const crashedCategories = categories.filter((c) => crashedCatIds.includes(c.id));
  const crashStartedAt    = settings?.crash_started_at ?? null;

  // 経過時間カウンター
  useEffect(() => {
    if (!isCrashActive || !crashStartedAt) { setElapsed(0); return; }
    const update = () => setElapsed(Math.floor((Date.now() - new Date(crashStartedAt).getTime()) / 1000));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [isCrashActive, crashStartedAt]);

  const resetMutation = useMutation({
    mutationFn: api.resetCrash,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['menu-all'] });
      queryClient.invalidateQueries({ queryKey: ['system-settings'] });
      setResetMsg(`暴落を解除しました（${data.updated}商品）`);
      setTimeout(() => setResetMsg(''), 3000);
    },
    onError: () => {
      setResetMsg('エラーが発生しました');
      setTimeout(() => setResetMsg(''), 3000);
    },
  });

  const handleCrashReset = () => {
    if (confirm('暴落中の商品を基準価格に戻しますか？')) {
      resetMutation.mutate();
    }
  };

  // 手動暴落(フェーズ3): 基準価格×50%を目標に急落（下限=原価×1.2）、5分で自動解除
  const manualCrashMutation = useMutation({
    mutationFn: api.manualCrash,
    onSuccess: (data) => {
      setManualModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ['menu-all'] });
      queryClient.invalidateQueries({ queryKey: ['system-settings'] });
      setManualMsg(`暴落ナイトを発動しました（${data.updated}商品・5分で自動解除）`);
      setTimeout(() => setManualMsg(''), 4000);
    },
    onError: () => {
      setManualMsg('エラーが発生しました');
      setTimeout(() => setManualMsg(''), 3000);
    },
  });

  const toggleManualCat = (id) =>
    setManualCatIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <Section title="株価暴落" desc="選択したカテゴリ・サブカテゴリ内の暴落許可商品を一括で暴落価格に変更します。">

      {/* 暴落中ステータスパネル */}
      {isCrashActive && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl">
          <div className="flex items-center gap-2 mb-3">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
            <span className="text-sm font-bold text-red-700">暴落実行中</span>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex gap-2 items-start">
              <span className="text-slate-500 w-20 flex-shrink-0">対象</span>
              <div className="flex flex-wrap gap-1.5">
                {crashedCategories.map((c) => (
                  <span key={c.id} className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700 border border-red-200">
                    {c.name}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex gap-2 items-center">
              <span className="text-slate-500 w-20 flex-shrink-0">実行時刻</span>
              <span className="font-medium text-slate-800 tabular-nums">{fmtStartTime(crashStartedAt)}</span>
            </div>
            <div className="flex gap-2 items-center">
              <span className="text-slate-500 w-20 flex-shrink-0">経過時間</span>
              <span className="font-bold text-red-600 tabular-nums text-base">{fmtElapsed(elapsed)}</span>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <div className="flex gap-3">
          <button
            onClick={handleCrashReset}
            disabled={resetMutation.isPending || !isCrashActive}
            className="inline-flex items-center justify-center gap-2 h-10 px-4 text-sm font-semibold bg-white text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            暴落を解除（暴落前価格へ戻す）
          </button>
        </div>
      </div>
      {resetMsg && <p className="mt-2 text-sm text-emerald-600 font-medium">{resetMsg}</p>}

      {/* 暴落ナイト（手動発動） */}
      <div className="mt-8 pt-6 border-t border-slate-200">
        <h3 className="text-sm font-bold text-slate-800 mb-1">暴落ナイト（手動発動）</h3>
        <p className="text-xs text-slate-500 mb-3">基準価格の約50%まで一気に急落させます（下限＝原価×1.2）。5分で自動解除、手動でも解除できます。</p>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <button
            onClick={() => setManualScope('all')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${manualScope === 'all' ? 'bg-red-600 text-white border-red-600' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}
          >
            全体
          </button>
          <button
            onClick={() => setManualScope('category')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${manualScope === 'category' ? 'bg-red-600 text-white border-red-600' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}
          >
            カテゴリ選択
          </button>
        </div>
        {manualScope === 'category' && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {categories.map((c) => (
              <button
                key={c.id}
                onClick={() => toggleManualCat(c.id)}
                className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${manualCatIds.includes(c.id) ? 'bg-red-100 text-red-700 border-red-300' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}
        <button
          onClick={() => setManualModalOpen(true)}
          disabled={isCrashActive || (manualScope === 'category' && manualCatIds.length === 0)}
          className="inline-flex items-center justify-center gap-2 h-11 px-5 text-sm font-bold bg-red-600 hover:bg-red-700 text-white rounded-lg cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          🔻 暴落発動
        </button>
        {manualMsg && <p className="mt-2 text-sm text-red-600 font-medium">{manualMsg}</p>}
      </div>

      {/* 手動暴落 確認モーダル（誤操作防止） */}
      {manualModalOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 fade-in">
          <div className="bg-white rounded-xl p-6 w-96 shadow-xl pop-in border border-slate-200">
            <h3 className="text-base font-bold text-slate-900 mb-2">暴落を発動しますか？</h3>
            <p className="text-sm text-slate-600 mb-1">
              対象: <strong>{manualScope === 'all' ? '全体（暴落許可の全ドリンク）' : `カテゴリ ${manualCatIds.length}件`}</strong>
            </p>
            <p className="text-sm text-slate-600 mb-5">基準価格の約50%へ急落（下限＝原価×1.2）／5分で自動解除。</p>
            <div className="flex gap-3">
              <button
                onClick={() => setManualModalOpen(false)}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition-colors"
              >
                キャンセル
              </button>
              <button
                onClick={() => manualCrashMutation.mutate({ scope: manualScope, category_ids: manualCatIds })}
                disabled={manualCrashMutation.isPending}
                className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white text-sm font-bold rounded-lg transition-colors disabled:opacity-50"
              >
                {manualCrashMutation.isPending ? '発動中...' : '発動する'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Section>
  );
}
