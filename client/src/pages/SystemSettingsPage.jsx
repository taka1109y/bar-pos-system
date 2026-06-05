import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

const RECEIPT_LABELS = { normal: '通常', red: '赤伝票', void: '取消', black_cancelled: '黒取消' };
const PAYMENT_LABELS = { cash: '現金', card: 'カード', emoney: '電子マネー' };
const LOG_LIMIT = 50;

function fmtDateTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function LogTab() {
  const today        = new Date().toISOString().slice(0, 10);
  const defaultFrom  = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  const [from,          setFrom]          = useState(defaultFrom);
  const [to,            setTo]            = useState(today);
  const [receiptType,   setReceiptType]   = useState('all');
  const [paymentMethod, setPaymentMethod] = useState('all');
  const [page,          setPage]          = useState(0);

  const [queryParams, setQueryParams] = useState({
    from: defaultFrom, to: today,
    receipt_type: 'all', payment_method: 'all',
    limit: LOG_LIMIT, offset: 0,
  });

  const { data, isFetching } = useQuery({
    queryKey: ['logs', queryParams],
    queryFn:  () => api.getLogs(queryParams),
    staleTime: 30_000,
  });

  const handleSearch = () => {
    setPage(0);
    setQueryParams({ from, to, receipt_type: receiptType, payment_method: paymentMethod, limit: LOG_LIMIT, offset: 0 });
  };

  const handlePage = (newPage) => {
    setPage(newPage);
    setQueryParams((prev) => ({ ...prev, offset: newPage * LOG_LIMIT }));
  };

  const orders     = data?.orders ?? [];
  const total      = data?.total  ?? 0;
  const totalPages = Math.ceil(total / LOG_LIMIT);

  const filterSel = 'h-9 px-3 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary-500/50';

  return (
    <div className="space-y-4">
      {/* 検索フィルター */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="leading-normal">
            <p className="text-xs font-semibold text-slate-500 mb-1">開始日</p>
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)}
              className={filterSel}
            />
          </div>
          <div className="leading-normal">
            <p className="text-xs font-semibold text-slate-500 mb-1">終了日</p>
            <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)}
              className={filterSel}
            />
          </div>
          <div className="leading-normal">
            <p className="text-xs font-semibold text-slate-500 mb-1">伝票種別</p>
            <select value={receiptType} onChange={(e) => setReceiptType(e.target.value)} className={filterSel}>
              <option value="all">全て</option>
              <option value="normal">通常</option>
              <option value="red">赤伝票</option>
              <option value="void">取消</option>
              <option value="black_cancelled">黒取消</option>
            </select>
          </div>
          <div className="leading-normal">
            <p className="text-xs font-semibold text-slate-500 mb-1">支払方法</p>
            <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className={filterSel}>
              <option value="all">全て</option>
              <option value="cash">現金</option>
              <option value="card">カード</option>
              <option value="emoney">電子マネー</option>
            </select>
          </div>
          <button
            onClick={handleSearch}
            disabled={isFetching}
            className="inline-flex items-center justify-center h-11 px-4 text-sm font-semibold bg-primary-500 hover:bg-primary-700 text-white rounded-lg cursor-pointer disabled:opacity-50 transition-colors"
          >
            検索
          </button>
        </div>
      </div>

      {/* 結果テーブル */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-700">
            {isFetching ? '読み込み中...' : `${total.toLocaleString()} 件`}
          </p>
          {totalPages > 1 && (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <button
                onClick={() => handlePage(page - 1)} disabled={page === 0}
                className="w-10 h-10 inline-flex items-center justify-center border border-slate-200 rounded-lg disabled:opacity-40 hover:bg-slate-50 text-base"
              >‹</button>
              <span>{page + 1} / {totalPages}</span>
              <button
                onClick={() => handlePage(page + 1)} disabled={page + 1 >= totalPages}
                className="w-10 h-10 inline-flex items-center justify-center border border-slate-200 rounded-lg disabled:opacity-40 hover:bg-slate-50 text-base"
              >›</button>
            </div>
          )}
        </div>
        {orders.length === 0 && !isFetching ? (
          <p className="text-base text-slate-500 text-center py-16">該当データがありません</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200 bg-gray-50">
                  <th scope="col" className="py-3 px-4 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">ID</th>
                  <th scope="col" className="py-3 px-4 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">会計日時</th>
                  <th scope="col" className="py-3 px-4 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">テーブル</th>
                  <th scope="col" className="py-3 px-4 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">支払</th>
                  <th scope="col" className="py-3 px-4 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">種別</th>
                  <th scope="col" className="py-3 px-4 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">合計</th>
                  <th scope="col" className="py-3 px-4 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">割引</th>
                  <th scope="col" className="py-3 px-4 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">備考</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => {
                  const isVoid = o.receipt_type === 'void' || o.receipt_type === 'black_cancelled';
                  return (
                    <tr key={o.id} className="border-b border-slate-100 last:border-0 hover:bg-gray-50 transition-colors">
                      <td className="py-3 px-4 text-sm text-slate-400">#{o.id}</td>
                      <td className="py-3 px-4 text-sm text-slate-900 whitespace-nowrap">{fmtDateTime(o.closed_at)}</td>
                      <td className="py-3 px-4 text-sm text-slate-900">{o.table_name ?? '-'}</td>
                      <td className="py-3 px-4 text-sm text-slate-700">{PAYMENT_LABELS[o.payment_method] ?? o.payment_method}</td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          o.receipt_type === 'red'             ? 'bg-red-100 text-red-700' :
                          o.receipt_type === 'void'            ? 'bg-amber-100 text-amber-700' :
                          o.receipt_type === 'black_cancelled' ? 'bg-gray-200 text-gray-600' :
                          'bg-slate-100 text-slate-700'
                        }`}>
                          {RECEIPT_LABELS[o.receipt_type] ?? o.receipt_type}
                        </span>
                      </td>
                      <td className={`py-3 px-4 text-sm text-right font-medium tabular-nums ${isVoid ? 'text-red-600' : 'text-slate-900'}`}>
                        ¥{o.total_amount.toLocaleString()}
                      </td>
                      <td className="py-3 px-4 text-sm text-right text-slate-500 tabular-nums">
                        {o.discount_amount > 0 ? `¥${o.discount_amount.toLocaleString()}` : '-'}
                      </td>
                      <td className="py-3 px-4 text-sm text-slate-500 max-w-[10rem] truncate">{o.memo ?? '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

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
    <div className="flex items-center gap-2">
      <input
        type="number" min="0" max="100" step="1"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${inp} w-20 text-right`}
      />
      <span className="text-sm text-slate-500">%</span>
    </div>
  );
}

function HourSelect({ value, onChange }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className={`${inp} w-32`}
    >
      {HOUR_OPTIONS.map((h) => (
        <option key={h} value={h}>{hourLabel(h)}</option>
      ))}
    </select>
  );
}

const PRICING_FIELDS = [
  { key: 'TICK_INTERVAL_MS', label: 'ティック間隔',       unit: '秒', desc: '価格再計算の実行間隔。変更はすぐに反映されます。', min: 5, step: 1, toDisplay: (v) => v / 1000, toApi: (v) => v * 1000 },
  { key: 'WINDOW_SECONDS',   label: '需要計測ウィンドウ', unit: '秒', desc: '過去何秒間の注文を需要として計測するか。',           min: 60,  step: 60 },
  { key: 'PRICE_STEP_DOWN',  label: '価格下降ステップ',   unit: '%',  desc: '需要がない場合に1ティックあたり何%ずつ基準価格へ戻すか。', min: 1, max: 50, step: 0.1, toDisplay: (v) => Math.round(v * 1000) / 10, toApi: (v) => v / 100 },
];

function PricingEngineTab() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(null);
  const [saved, setSaved] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['pricingSettings'],
    queryFn: api.getPricingSettings,
    staleTime: 0,
  });

  const updateMutation = useMutation({
    mutationFn: api.updatePricingSettings,
    onSuccess: (res) => {
      queryClient.setQueryData(['pricingSettings'], (old) => ({ ...old, settings: res.settings }));
      setDraft({ ...res.settings });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const resetMutation = useMutation({
    mutationFn: api.resetPricingSettings,
    onSuccess: (res) => {
      queryClient.setQueryData(['pricingSettings'], (old) => ({ ...old, settings: res.settings }));
      setDraft({ ...res.settings });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  if (isLoading || !data) return <p className="text-sm text-slate-400">読み込み中...</p>;

  const currentDraft = draft ?? data.settings;
  const isDirty = PRICING_FIELDS.some((f) => currentDraft[f.key] !== data.settings[f.key]);

  return (
    <div className="space-y-4">
      {PRICING_FIELDS.map((field) => {
        const toDisp = field.toDisplay ?? ((v) => v);
        const current = toDisp(currentDraft[field.key]);
        const def = toDisp(data.defaults[field.key]);
        const isChanged = current !== toDisp(data.settings[field.key]);
        return (
          <div key={field.key} className="bg-white rounded-xl border border-slate-200 p-6">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-slate-800">{field.label}</span>
                  {isChanged && <span className="text-[10px] px-1.5 py-0.5 bg-primary-50 text-primary-600 rounded font-medium">変更済</span>}
                </div>
                <p className="text-xs text-slate-400 mt-0.5">{field.desc}</p>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <input
                  type="number" value={current}
                  onChange={(e) => {
                    const apiVal = field.toApi ? field.toApi(Number(e.target.value)) : Number(e.target.value);
                    setDraft((prev) => ({ ...(prev ?? data.settings), [field.key]: apiVal }));
                  }}
                  min={field.min} max={field.max} step={field.step}
                  className={`${inp} w-28 text-right`}
                />
                <span className="text-xs text-slate-400 w-8">{field.unit}</span>
              </div>
            </div>
            <div className="text-xs text-slate-400">デフォルト: <span className="font-mono text-slate-500">{def}</span></div>
          </div>
        );
      })}
      <div className="flex items-center gap-3 mt-6">
        <button
          onClick={() => updateMutation.mutate(currentDraft)}
          disabled={!isDirty || updateMutation.isPending}
          className="inline-flex items-center justify-center gap-2 h-12 px-4 text-sm font-semibold bg-primary-500 text-white rounded-lg hover:bg-primary-700 cursor-pointer disabled:opacity-40 transition-colors"
        >
          {updateMutation.isPending ? '保存中...' : '変更を保存'}
        </button>
        <button
          onClick={() => { if (window.confirm('すべてデフォルト値に戻しますか？')) resetMutation.mutate(); }}
          disabled={resetMutation.isPending}
          className="inline-flex items-center justify-center gap-2 h-12 px-4 text-sm font-medium bg-white text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer disabled:opacity-40 transition-colors"
        >
          デフォルトに戻す
        </button>
        {saved && (
          <div className="flex items-start gap-3 px-4 py-2.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-xs font-medium">
            ✓ 保存しました
          </div>
        )}
        {(updateMutation.isError || resetMutation.isError) && (
          <span className="text-xs text-red-500">{updateMutation.error?.message ?? resetMutation.error?.message}</span>
        )}
      </div>
    </div>
  );
}

const TABS = [
  { id: 'tax',         label: '消費税' },
  { id: 'late',        label: '深夜料金' },
  { id: 'charge',      label: 'チャージ' },
  { id: 'crash',       label: '暴落' },
  { id: 'pricing',     label: '価格エンジン' },
  { id: 'log',         label: 'ログ' },
  { id: 'maintenance', label: 'メンテナンス' },
];

export default function SystemSettingsPage() {
  const queryClient = useQueryClient();

  const [activeTab,         setActiveTab]         = useState('tax');
  const [taxInput,          setTaxInput]          = useState('');
  const [reducedTaxInput,   setReducedTaxInput]   = useState('');
  const [defaultTaxCategory, setDefaultTaxCategory] = useState('standard');
  const [lnRate,            setLnRate]            = useState('');
  const [lnStart,           setLnStart]           = useState(22);
  const [lnEnd,             setLnEnd]             = useState(29);
  const [savedTax,          setSavedTax]          = useState(false);
  const [savedLn,           setSavedLn]           = useState(false);
  const [chargeEnabled,     setChargeEnabled]     = useState(true);
  const [chargeSlots,       setChargeSlots]       = useState([]);
  const [savedCharge,       setSavedCharge]       = useState(false);
  const [archiveConfirm,    setArchiveConfirm]    = useState(false);
  const [archiveResult,     setArchiveResult]     = useState(null);
  const [archiveError,      setArchiveError]      = useState(null);
  const [archivePending,    setArchivePending]    = useState(false);

  const { data: settings, isLoading } = useQuery({
    queryKey: ['system-settings'],
    queryFn: api.getSystemSettings,
  });

  const { data: categories    = [] } = useQuery({ queryKey: ['categories-staff'], queryFn: api.getStaffCategories });
  const { data: subcategories = [] } = useQuery({ queryKey: ['subcategories'], queryFn: api.getSubcategories });
  const { data: menuItems     = [] } = useQuery({ queryKey: ['menu-all'],      queryFn: api.getAllMenu });

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

  const fmtElapsed = (sec) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const fmtStartTime = (iso) => {
    if (!iso) return '-';
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  };

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

  useEffect(() => {
    if (!settings) return;
    setTaxInput(String(Math.round(settings.tax_rate * 100)));
    setReducedTaxInput(String(Math.round((settings.reduced_tax_rate ?? 0.08) * 100)));
    setDefaultTaxCategory(settings.default_tax_category ?? 'standard');
    setLnRate(String(Math.round(settings.late_night_rate * 100)));
    setLnStart(settings.late_night_start);
    setLnEnd(settings.late_night_end);
    setChargeEnabled(settings.charge_enabled !== false);
    setChargeSlots(settings.charge_time_slots ?? []);
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: (data) => api.updateSystemSettings(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['system-settings'] }),
  });

  const handleSaveTax = () => {
    const pct        = parseFloat(taxInput);
    const reducedPct = parseFloat(reducedTaxInput);
    if (isNaN(pct)        || pct < 0        || pct > 100)        return;
    if (isNaN(reducedPct) || reducedPct < 0 || reducedPct > 100) return;
    saveMutation.mutate(
      { tax_rate: pct / 100, reduced_tax_rate: reducedPct / 100, default_tax_category: defaultTaxCategory },
      { onSuccess: () => { setSavedTax(true); setTimeout(() => setSavedTax(false), 2000); } }
    );
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

  const handleSaveCharge = () => {
    for (const s of chargeSlots) {
      if (s.start >= s.end) return;
      if (s.amount < 0) return;
    }
    saveMutation.mutate(
      { charge_enabled: chargeEnabled, charge_time_slots: chargeSlots },
      { onSuccess: () => { setSavedCharge(true); setTimeout(() => setSavedCharge(false), 2000); } }
    );
  };

  const addSlot = () =>
    setChargeSlots((prev) => [...prev, { label: '', start: 17, end: 23, amount: 500 }]);

  const updateSlot = (i, key, val) =>
    setChargeSlots((prev) => prev.map((s, idx) => idx === i ? { ...s, [key]: val } : s));

  const removeSlot = (i) =>
    setChargeSlots((prev) => prev.filter((_, idx) => idx !== i));

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
    <div className="px-8 py-12 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-slate-900">システム管理</h1>
      </div>
      {/* タブ */}
      <div className="flex gap-4 border-b border-slate-200 mb-6">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === tab.id
                ? 'text-primary-500 border-primary-500'
                : 'text-slate-500 border-transparent hover:text-slate-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {isLoading ? (
        <p className="text-sm text-slate-400">読み込み中...</p>
      ) : (
        <>
          {/* ── 消費税設定 ── */}
          {activeTab === 'tax' && <Section title="消費税設定" desc="会計時に適用される消費税率。商品ごとに標準・軽減を選択できます。">
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={lbl}>標準税率（%）</label>
                  <NumberPctInput value={taxInput} onChange={setTaxInput} />
                </div>
                <div>
                  <label className={lbl}>軽減税率（%）</label>
                  <NumberPctInput value={reducedTaxInput} onChange={setReducedTaxInput} />
                </div>
              </div>
              <div>
                <label className={lbl}>新規商品のデフォルト税率区分</label>
                <div className="flex gap-2">
                  {[
                    { value: 'standard', label: `標準（${taxInput}%）` },
                    { value: 'reduced',  label: `軽減（${reducedTaxInput}%）` },
                  ].map(({ value, label }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setDefaultTaxCategory(value)}
                      className={`flex-1 h-10 rounded-lg border-2 text-sm font-medium transition-colors ${
                        defaultTaxCategory === value
                          ? 'border-primary-500 bg-primary-50 text-primary-700'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex justify-end">
                {saveBtn(savedTax, handleSaveTax)}
              </div>
              {savedTax && (
                <div className="flex items-start gap-3 p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-xs font-medium">
                  ✓ 保存しました
                </div>
              )}
            </div>
          </Section>}

          {/* ── 深夜料金設定 ── */}
          {activeTab === 'late' && <Section
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
          </Section>}

          {/* ── チャージ設定 ── */}
          {activeTab === 'charge' && <Section
            title="チャージ設定"
            desc="入店時に人数×料金を自動で注文に追加します。時間帯ごとに料金を設定できます。"
          >
            <div className="space-y-4">
              {/* 有効/無効 */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-700">チャージを有効にする</p>
                  <p className="text-xs text-slate-400 mt-0.5">無効にするとチャージは発生しません</p>
                </div>
                <button
                  type="button"
                  onClick={() => setChargeEnabled((v) => !v)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${chargeEnabled ? 'bg-primary-500' : 'bg-slate-300'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${chargeEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>

              {/* 時間帯スロット */}
              <div>
                <p className="text-xs font-semibold text-slate-500 mb-2">時間帯別料金（人数 × 料金/人）</p>
                {chargeSlots.length === 0 && (
                  <p className="text-xs text-slate-400 py-2">時間帯が設定されていません（チャージなし）</p>
                )}
                <div className="space-y-2">
                  {chargeSlots.map((slot, i) => (
                    <div key={i} className="bg-slate-50 rounded-lg border border-slate-200 p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          placeholder="ラベル（例: ハッピーアワー）"
                          value={slot.label ?? ''}
                          onChange={(e) => updateSlot(i, 'label', e.target.value)}
                          className="flex-1 bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-500/50"
                        />
                        <button
                          type="button"
                          onClick={() => removeSlot(i)}
                          className="w-9 h-9 flex items-center justify-center rounded-lg text-red-400 hover:bg-red-50 border border-red-200 flex-shrink-0"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                          </svg>
                        </button>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="leading-normal">
                          <p className="text-[10px] text-slate-400 mb-1">開始</p>
                          <HourSelect value={slot.start} onChange={(v) => updateSlot(i, 'start', v)} />
                        </div>
                        <span className="text-slate-400 text-sm mt-4">〜</span>
                        <div className="leading-normal">
                          <p className="text-[10px] text-slate-400 mb-1">終了</p>
                          <HourSelect value={slot.end} onChange={(v) => updateSlot(i, 'end', v)} />
                        </div>
                        <div className="leading-normal">
                          <p className="text-[10px] text-slate-400 mb-1">料金/人（円）</p>
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-slate-400">¥</span>
                            <input
                              type="number" min="0" step="100"
                              value={slot.amount}
                              onChange={(e) => updateSlot(i, 'amount', parseInt(e.target.value) || 0)}
                              className="w-24 bg-white border border-slate-300 rounded-lg px-2.5 py-2 text-sm text-right text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-500/50"
                            />
                          </div>
                        </div>
                      </div>
                      {slot.start >= slot.end && (
                        <p className="text-[10px] text-red-500">終了時刻は開始より後にしてください</p>
                      )}
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={addSlot}
                  className="mt-2 inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold bg-white border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  + 時間帯を追加
                </button>
              </div>

              <div className="flex justify-end">
                {saveBtn(savedCharge, handleSaveCharge)}
              </div>
              {savedCharge && (
                <div className="flex items-start gap-3 p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-xs font-medium">
                  ✓ 保存しました
                </div>
              )}
            </div>
          </Section>}

          {/* ── 価格エンジン ── */}
          {activeTab === 'pricing' && <PricingEngineTab />}

          {/* ── ログ ── */}
          {activeTab === 'log' && <LogTab />}

          {/* ── メンテナンス ── */}
          {activeTab === 'maintenance' && <Section title="データアーカイブ" desc="90日以前の会計済みデータを削除してDB容量を削減します。実行前に伝票一覧PDFを出力し、NASへ保存してください。">
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
          </Section>}

          {/* ── 株価暴落 ── */}
          {activeTab === 'crash' && <Section title="株価暴落" desc="選択したカテゴリ・サブカテゴリ内の暴落許可商品を一括で暴落価格に変更します。">

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
          </Section>}
        </>
      )}
    </div>
  );
}
