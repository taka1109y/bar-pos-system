import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

const inp =
  'w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 caret-primary-500 transition-colors';

const lbl = 'block text-xs font-semibold text-slate-500 mb-1.5';

// 32時間制のラベル生成
function hourLabel(h) {
  if (h < 24) return `${h}:00`;
  return `翌${h - 24}:00`;
}
const HOUR_OPTIONS = Array.from({ length: 33 }, (_, i) => i); // 0–32

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
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 flex-shrink-0">
          <h2 className="text-base font-bold text-slate-900">暴落対象を選択</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
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
        <div className="px-5 py-4 border-t border-slate-100 flex-shrink-0 space-y-3">
          <p className="text-sm text-slate-600">
            対象商品: <span className="font-bold text-red-600">{eligibleCount} 商品</span>が暴落します
          </p>
          <div className="flex gap-2.5">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-medium transition-colors"
            >
              キャンセル
            </button>
            <button
              onClick={() => onExecute({
                category_ids:    Array.from(selectedCatIds),
                subcategory_ids: Array.from(selectedSubcatIds),
              })}
              disabled={isPending || eligibleCount === 0}
              className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-bold transition-colors shadow-sm disabled:opacity-50"
            >
              {isPending ? '実行中...' : '暴落を実行'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, desc, children }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6">
      <div className="mb-4">
        <h3 className="text-sm font-bold text-slate-700">{title}</h3>
        {desc && <p className="text-xs text-slate-400 mt-0.5">{desc}</p>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function NumberPctInput({ value, onChange }) {
  return (
    <div className="flex items-center border border-slate-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-primary-500/50 bg-white">
      <input
        type="number" min="0" max="100" step="1"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-24 px-3 py-2.5 text-sm text-slate-900 outline-none text-right"
      />
      <span className="px-3 py-2.5 text-sm text-slate-500 bg-slate-50 border-l border-slate-200">%</span>
    </div>
  );
}

function HourSelect({ value, onChange }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="bg-white border border-slate-300 rounded-lg px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 transition-colors"
    >
      {HOUR_OPTIONS.map((h) => (
        <option key={h} value={h}>{hourLabel(h)}</option>
      ))}
    </select>
  );
}

export default function SystemSettingsPage() {
  const queryClient = useQueryClient();

  const [taxInput,  setTaxInput]  = useState('');
  const [lnRate,    setLnRate]    = useState('');
  const [lnStart,   setLnStart]   = useState(22);
  const [lnEnd,     setLnEnd]     = useState(29);
  const [savedTax,  setSavedTax]  = useState(false);
  const [savedLn,   setSavedLn]   = useState(false);

  const { data: settings, isLoading } = useQuery({
    queryKey: ['system-settings'],
    queryFn: api.getSystemSettings,
  });

  const { data: categories    = [] } = useQuery({ queryKey: ['categories'],    queryFn: api.getCategories });
  const { data: subcategories = [] } = useQuery({ queryKey: ['subcategories'], queryFn: api.getSubcategories });
  const { data: menuItems     = [] } = useQuery({ queryKey: ['menu-all'],      queryFn: api.getAllMenu });

  const [crashModalOpen, setCrashModalOpen] = useState(false);
  const [crashMsg,       setCrashMsg]       = useState('');
  const [resetMsg,       setResetMsg]       = useState('');

  const crashMutation = useMutation({
    mutationFn: api.triggerCrash,
    onSuccess: (data) => {
      setCrashModalOpen(false);
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

  useEffect(() => {
    if (!settings) return;
    setTaxInput(String(Math.round(settings.tax_rate * 100)));
    setLnRate(String(Math.round(settings.late_night_rate * 100)));
    setLnStart(settings.late_night_start);
    setLnEnd(settings.late_night_end);
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: (data) => api.updateSystemSettings(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['system-settings'] }),
  });

  const handleSaveTax = () => {
    const pct = parseFloat(taxInput);
    if (isNaN(pct) || pct < 0 || pct > 100) return;
    saveMutation.mutate({ tax_rate: pct / 100 }, {
      onSuccess: () => { setSavedTax(true); setTimeout(() => setSavedTax(false), 2000); },
    });
  };

  const handleSaveLn = () => {
    const pct = parseFloat(lnRate);
    if (isNaN(pct) || pct < 0 || pct > 100) return;
    if (lnStart >= lnEnd) return;
    saveMutation.mutate(
      { late_night_rate: pct / 100, late_night_start: lnStart, late_night_end: lnEnd },
      { onSuccess: () => { setSavedLn(true); setTimeout(() => setSavedLn(false), 2000); } }
    );
  };

  const saveBtn = (saved, onClick) => (
    <button
      onClick={onClick}
      disabled={saveMutation.isPending}
      className={`inline-flex items-center justify-center gap-2 h-10 px-4 text-sm font-semibold rounded-lg transition-colors cursor-pointer disabled:opacity-50 ${
        saved ? 'bg-emerald-500 text-white' : 'bg-primary-500 hover:bg-primary-700 text-white'
      }`}
    >
      {saved ? '保存しました' : '保存'}
    </button>
  );

  const taxPct = parseFloat(taxInput) || 0;
  const lnPct  = parseFloat(lnRate)   || 0;

  return (
    <div className="p-8 max-w-2xl mx-auto space-y-6">
      {isLoading ? (
        <p className="text-sm text-slate-400">読み込み中...</p>
      ) : (
        <>
          {/* ── 消費税設定 ── */}
          <Section title="消費税設定" desc="会計時に適用される消費税率。変更後の会計から反映されます。">
            <div className="space-y-4">
              <div>
                <label className={lbl}>消費税率（%）</label>
                <div className="flex items-center gap-3">
                  <NumberPctInput value={taxInput} onChange={setTaxInput} />
                  {saveBtn(savedTax, handleSaveTax)}
                </div>
                {savedTax && (
                  <div className="mt-3 flex items-start gap-3 p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-xs font-medium">
                    ✓ 保存しました
                  </div>
                )}
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-sm space-y-1">
                <p className="text-xs font-medium text-slate-500 mb-2">計算例（¥1,000 の場合）</p>
                <div className="flex justify-between text-slate-600">
                  <span>小計（税抜き）</span><span>¥1,000</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>消費税（{taxPct}%）</span>
                  <span>¥{Math.round(1000 * taxPct / 100).toLocaleString()}</span>
                </div>
                <div className="flex justify-between font-bold text-slate-900 pt-1 border-t border-slate-200 mt-1">
                  <span>合計（税込み）</span>
                  <span>¥{(1000 + Math.round(1000 * taxPct / 100)).toLocaleString()}</span>
                </div>
              </div>
            </div>
          </Section>

          {/* ── 深夜料金設定 ── */}
          <Section
            title="深夜料金設定"
            desc="指定時間帯の会計に加算される料金。開始・終了時刻は32時間制で入力（例: 翌3時 = 27）。"
          >
            <div className="space-y-4">
              <div>
                <label className={lbl}>深夜料金率（%）</label>
                <NumberPctInput value={lnRate} onChange={setLnRate} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={lbl}>開始時刻</label>
                  <HourSelect value={lnStart} onChange={setLnStart} />
                </div>
                <div>
                  <label className={lbl}>終了時刻</label>
                  <HourSelect value={lnEnd} onChange={setLnEnd} />
                </div>
              </div>
              {lnStart >= lnEnd && (
                <p className="text-xs text-red-500">終了時刻は開始時刻より後にしてください</p>
              )}
              <div className="flex justify-end">
                {saveBtn(savedLn, handleSaveLn)}
              </div>
              {savedLn && (
                <div className="flex items-start gap-3 p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-xs font-medium">
                  ✓ 保存しました
                </div>
              )}
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm space-y-1">
                <p className="text-xs font-medium text-amber-700 mb-2">
                  計算例（¥1,000 · {hourLabel(lnStart)}〜{hourLabel(lnEnd)} の会計）
                </p>
                <div className="flex justify-between text-amber-700">
                  <span>小計（税抜き）</span><span>¥1,000</span>
                </div>
                <div className="flex justify-between text-amber-700">
                  <span>深夜料金（{lnPct}%）</span>
                  <span>¥{Math.round(1000 * lnPct / 100).toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>消費税（{taxPct}%）</span>
                  <span>¥{Math.round((1000 + Math.round(1000 * lnPct / 100)) * taxPct / 100).toLocaleString()}</span>
                </div>
                <div className="flex justify-between font-bold text-slate-900 pt-1 border-t border-amber-200 mt-1">
                  <span>合計（税込み）</span>
                  <span>
                    ¥{(
                      1000 +
                      Math.round(1000 * lnPct / 100) +
                      Math.round((1000 + Math.round(1000 * lnPct / 100)) * taxPct / 100)
                    ).toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          </Section>

          {/* ── 株価暴落 ── */}
          <Section title="株価暴落" desc="選択したカテゴリ・サブカテゴリ内の暴落許可商品を一括で暴落価格に変更します。">
            <div className="flex gap-3">
              <button
                onClick={() => setCrashModalOpen(true)}
                className="inline-flex items-center justify-center gap-2 h-10 px-4 text-sm font-semibold bg-red-600 hover:bg-red-700 text-white rounded-lg cursor-pointer transition-colors"
              >
                暴落を実行
              </button>
              <button
                onClick={handleCrashReset}
                disabled={resetMutation.isPending}
                className="inline-flex items-center justify-center gap-2 h-10 px-4 text-sm font-semibold bg-white text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer disabled:opacity-50 transition-colors"
              >
                暴落解除
              </button>
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
        </>
      )}
    </div>
  );
}
