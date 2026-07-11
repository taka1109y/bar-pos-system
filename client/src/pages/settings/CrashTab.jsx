import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import Section from './Section';

function CrashModal({ categories, subcategories, menuItems, onClose, onExecute, isPending }) {
  const [selectedCatIds,    setSelectedCatIds]    = useState(new Set());
  const [selectedSubcatIds, setSelectedSubcatIds] = useState(new Set());

  const subcatsByCategory = subcategories.reduce((acc, s) => {
    if (!acc[s.category_id]) acc[s.category_id] = [];
    acc[s.category_id].push(s);
    return acc;
  }, {});

  const toggleCategory = (catId) => {
    const subs = subcatsByCategory[catId] ?? [];
    const isSelected = selectedCatIds.has(catId);
    setSelectedCatIds((prev) => {
      const next = new Set(prev);
      isSelected ? next.delete(catId) : next.add(catId);
      return next;
    });
    setSelectedSubcatIds((prev) => {
      const next = new Set(prev);
      subs.forEach((s) => isSelected ? next.delete(s.id) : next.add(s.id));
      return next;
    });
  };

  const toggleSubcategory = (subId) => {
    setSelectedSubcatIds((prev) => {
      const next = new Set(prev);
      next.has(subId) ? next.delete(subId) : next.add(subId);
      return next;
    });
  };

  const eligibleCount = menuItems.filter((item) =>
    item.crash_enabled &&
    item.is_active &&
    (selectedCatIds.has(item.category_id) || selectedSubcatIds.has(item.subcategory_id))
  ).length;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 border border-slate-200 max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 flex-shrink-0">
          <h2 className="text-base font-bold text-slate-900">暴落対象を選択</h2>
          <button
            onClick={onClose}
            aria-label="閉じる"
            className="w-10 h-10 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-1">
          {categories.map((cat) => {
            const subs = subcatsByCategory[cat.id] ?? [];
            return (
              <div key={cat.id}>
                <label className="flex items-center gap-3 py-2 cursor-pointer hover:bg-slate-50 rounded-lg px-2">
                  <input
                    type="checkbox"
                    checked={selectedCatIds.has(cat.id)}
                    onChange={() => toggleCategory(cat.id)}
                    className="w-4 h-4 accent-red-600 rounded"
                  />
                  <span className="text-sm font-semibold text-slate-800 flex-1">{cat.name}</span>
                  {cat.crash_pct > 0 && (
                    <span className="text-xs text-red-500 font-bold">▼{cat.crash_pct}%</span>
                  )}
                </label>
                {subs.map((sub) => (
                  <label key={sub.id} className="flex items-center gap-3 py-1.5 cursor-pointer hover:bg-slate-50 rounded-lg pl-8 pr-2">
                    <input
                      type="checkbox"
                      checked={selectedSubcatIds.has(sub.id)}
                      onChange={() => toggleSubcategory(sub.id)}
                      className="w-4 h-4 accent-red-600 rounded"
                    />
                    <span className="text-sm text-slate-700 flex-1">{sub.name}</span>
                    {sub.crash_pct > 0 && (
                      <span className="text-xs text-red-500 font-bold">▼{sub.crash_pct}%</span>
                    )}
                  </label>
                ))}
              </div>
            );
          })}
        </div>
        <div className="px-5 py-4 border-t border-slate-200 flex-shrink-0 space-y-3">
          <p className="text-sm text-slate-600">
            対象商品: <span className="font-bold text-red-600">{eligibleCount} 商品</span>が暴落します
          </p>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-4 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-medium transition-colors"
            >
              キャンセル
            </button>
            <button
              onClick={() => onExecute({
                category_ids:    Array.from(selectedCatIds),
                subcategory_ids: Array.from(selectedSubcatIds),
              })}
              disabled={isPending || eligibleCount === 0}
              className="flex-1 py-4 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-bold transition-colors shadow-sm disabled:opacity-50"
            >
              {isPending ? '実行中...' : '暴落を実行'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

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
  const { data: subcategories = [] } = useQuery({ queryKey: ['subcategories'], queryFn: api.getSubcategories });
  const { data: menuItems     = [] } = useQuery({ queryKey: ['menu-all'], queryFn: api.getAllMenu });

  const [crashModalOpen, setCrashModalOpen] = useState(false);
  const [crashMsg,       setCrashMsg]       = useState('');
  const [resetMsg,       setResetMsg]       = useState('');
  const [elapsed,        setElapsed]        = useState(0);

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

  const crashMutation = useMutation({
    mutationFn: api.triggerCrash,
    onSuccess: (data) => {
      setCrashModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ['menu-all'] });
      queryClient.invalidateQueries({ queryKey: ['system-settings'] });
      setCrashMsg(`暴落を実行しました（${data.updated}商品）`);
      setTimeout(() => setCrashMsg(''), 3000);
    },
    onError: () => {
      setCrashMsg('エラーが発生しました');
      setTimeout(() => setCrashMsg(''), 3000);
    },
  });

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
            onClick={() => {
              if (isCrashActive) return;
              setCrashModalOpen(true);
            }}
            disabled={isCrashActive}
            className="inline-flex items-center justify-center gap-2 h-10 px-4 text-sm font-semibold bg-red-600 hover:bg-red-700 text-white rounded-lg cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            暴落を実行
          </button>
          <button
            onClick={handleCrashReset}
            disabled={resetMutation.isPending || !isCrashActive}
            className="inline-flex items-center justify-center gap-2 h-10 px-4 text-sm font-semibold bg-white text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            暴落解除
          </button>
        </div>
        {isCrashActive && (
          <p className="text-sm text-amber-600 font-medium">
            ※ 再度実施する際は一度解除してからおこなってください
          </p>
        )}
      </div>
      {crashMsg && <p className="mt-2 text-sm text-red-600 font-medium">{crashMsg}</p>}
      {resetMsg && <p className="mt-2 text-sm text-emerald-600 font-medium">{resetMsg}</p>}
      {crashModalOpen && (
        <CrashModal
          categories={categories}
          subcategories={subcategories}
          menuItems={menuItems}
          onClose={() => setCrashModalOpen(false)}
          onExecute={(data) => crashMutation.mutate(data)}
          isPending={crashMutation.isPending}
        />
      )}
    </Section>
  );
}
