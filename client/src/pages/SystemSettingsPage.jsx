import { useState, useEffect } from 'react';
import { yen } from '../utils/format';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import Section from './settings/Section';
import CrashTab from './settings/CrashTab';
import MaintenanceTab from './settings/MaintenanceTab';

const RECEIPT_LABELS = { normal: '通常', red: '赤伝票', void: '取消', black_cancelled: '黒取消' };
const PAYMENT_LABELS = { cash: '現金', card: 'カード', emoney: '電子マネー', split: '分割' };
const LOG_LIMIT = 50;

// 分割伝票の内訳テキスト（例: "現金¥2,000 / カード¥3,000"）
function splitBreakdown(o) {
  return ['cash', 'card', 'emoney']
    .filter((k) => (o[`${k}_amount`] ?? 0) > 0)
    .map((k) => `${PAYMENT_LABELS[k]}¥${yen(Math.floor(o[`${k}_amount`]))}`)
    .join(' / ');
}

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
              <option value="split">分割</option>
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
            {isFetching ? '読み込み中...' : `${yen(total)} 件`}
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
                      <td className="py-3 px-4 text-sm text-slate-700">
                        {o.payment_method === 'split' ? (
                          <div>
                            <span className="font-medium">分割</span>
                            <span className="block text-[11px] text-slate-400">{splitBreakdown(o)}</span>
                          </div>
                        ) : (PAYMENT_LABELS[o.payment_method] ?? o.payment_method)}
                      </td>
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
                        ¥{yen(o.total_amount)}
                      </td>
                      <td className="py-3 px-4 text-sm text-right text-slate-500 tabular-nums">
                        {o.discount_amount > 0 ? `¥${yen(o.discount_amount)}` : '-'}
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

// 残り時間を mm:ss で表示（過ぎている/未設定は null）
function remainMMSS(iso, nowMs) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - nowMs;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// 価格モデル（呼値ラダー＋期）の状態を読み取り表示するタブ
// Phase4 で需要ウィンドウ／ティック間隔／下降ステップは廃止。ここは編集不可の情報表示のみ。
function PriceModelTab() {
  // now=0 は「まだ時刻未取得」。マウント直後に effect が実際の時刻を入れる（render 中に Date.now() を呼ばない）
  const [now, setNow] = useState(0);

  const { data: settings, isLoading } = useQuery({
    queryKey: ['system-settings'],
    queryFn: api.getSystemSettings,
    staleTime: 0,
    refetchInterval: 10_000,
  });

  // 1秒ごとにカウントダウン用の現在時刻を更新
  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  // Phase6-3: 手動 寄り付きリセット
  const queryClient = useQueryClient();
  const [openMsg, setOpenMsg] = useState('');
  const marketOpenMutation = useMutation({
    mutationFn: api.marketOpen,
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ['system-settings'] });
      setOpenMsg(`寄り付きを実行しました（${r?.changed ?? 0}銘柄をanchorへ）`);
      setTimeout(() => setOpenMsg(''), 4000);
    },
    onError: () => { setOpenMsg('エラーが発生しました'); setTimeout(() => setOpenMsg(''), 4000); },
  });

  // Phase6-7: 月次値引き費用上限(0=無効)
  const [capInput, setCapInput] = useState(null); // null=未編集
  const [capMsg, setCapMsg] = useState('');
  const saveCapMutation = useMutation({
    mutationFn: (v) => api.updateSystemSettings({ monthly_discount_cap: v }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system-settings'] });
      setCapMsg('保存しました'); setTimeout(() => setCapMsg(''), 3000);
    },
    onError: () => { setCapMsg('エラーが発生しました'); setTimeout(() => setCapMsg(''), 3000); },
  });

  if (isLoading || !settings) return <p className="text-sm text-slate-400">読み込み中...</p>;

  const model         = settings.price_model ?? {};
  const periodMinutes = model.period_minutes ?? 15;
  const ladderSteps   = model.ladder_steps   ?? 12;
  const periodRemain  = now > 0 ? remainMMSS(settings.period_ends_at, now) : null;
  const crashRemain   = now > 0 ? remainMMSS(settings.crash_ends_at, now) : null;
  const isCrashing    = crashRemain !== null;

  const stat = (label, value, sub) => (
    <div className="bg-white rounded-xl border border-slate-200 p-6">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">{value}</div>
      {sub && <div className="text-xs text-slate-400 mt-1">{sub}</div>}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 p-4 bg-primary-50 border border-primary-200 text-primary-800 rounded-lg text-sm">
        <span>
          価格は各商品ごとの下限〜上限を{ladderSteps}段に刻んだ「呼値ラダー」を、{periodMinutes}分ごとの「期」で上下します。
          注文が入ると即時に1段上昇、期内に注文がなければ1段下降します。下限／上限とラダーは基準価格・原価から自動計算され、商品ごとに設定します（商品管理で確認）。
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {stat('期の長さ', `${periodMinutes} 分`, '注文がなければ1段下降する間隔')}
        {stat('ラダー段数', `${ladderSteps} 段`, '下限〜上限を刻む段数')}
        {stat('現在の期の残り', periodRemain ?? '—', periodRemain ? '次の変動までの時間' : '待機中（次期の開始待ち）')}
        {stat(
          '暴落状態',
          isCrashing ? `暴落中 残り ${crashRemain}` : '通常',
          isCrashing ? '最下段へ急落中。時間経過で暴落前価格へ復帰' : '暴落は発生していません',
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="text-sm font-semibold text-slate-800">手動 寄り付きリセット（例外用）</div>
        <p className="text-xs text-slate-400 mt-1">
          通常はレジオープン時に自動実行されます。全ての変動対象銘柄を寄り付き値（基準価格×1.1）へ戻し、期の起点を今に合わせます。
        </p>
        <div className="flex items-center gap-3 mt-3">
          <button
            onClick={() => { if (window.confirm('全ての変動対象銘柄を寄り付き値へ戻します。よろしいですか？')) marketOpenMutation.mutate(); }}
            disabled={marketOpenMutation.isPending}
            className="inline-flex items-center justify-center gap-2 h-10 px-4 text-sm font-medium bg-primary-500 text-white rounded-lg hover:bg-primary-700 cursor-pointer disabled:opacity-40 transition-colors"
          >
            {marketOpenMutation.isPending ? '実行中...' : '寄り付きリセットを実行'}
          </button>
          {openMsg && <span className="text-xs text-emerald-700">{openMsg}</span>}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="text-sm font-semibold text-slate-800">月次 値引き費用の上限（暴落原資）</div>
        <p className="text-xs text-slate-400 mt-1">
          値引き費用（約定＜定価の合計）の月次上限。0 で無効。超過すると売上管理の「値引き費用」カードに警告が出ます。
        </p>
        <div className="flex items-end gap-3 mt-3 leading-normal">
          <label className="leading-normal">
            <span className="block text-xs font-medium text-slate-500 mb-1">上限（円 / 0=無効）</span>
            <input
              type="number" min={0} step={1000}
              value={capInput ?? settings.monthly_discount_cap ?? 0}
              onChange={(e) => setCapInput(e.target.value)}
              className="w-40 h-11 px-3 text-base border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500/50 leading-normal text-right"
            />
          </label>
          <button
            onClick={() => saveCapMutation.mutate(Math.max(0, parseInt(capInput ?? settings.monthly_discount_cap ?? 0, 10) || 0))}
            disabled={saveCapMutation.isPending}
            className="inline-flex items-center justify-center gap-2 h-11 px-4 text-sm font-medium bg-primary-500 text-white rounded-lg hover:bg-primary-700 cursor-pointer disabled:opacity-40 transition-colors"
          >
            {saveCapMutation.isPending ? '保存中...' : '保存'}
          </button>
          {capMsg && <span className="text-xs text-emerald-700 mb-3">{capMsg}</span>}
        </div>
      </div>

      <p className="text-xs text-slate-400">
        ※ この画面は状態確認用です。暴落の発動／解除は「暴落」タブ、商品ごとの価格レンジは「商品管理」で操作します。
      </p>
    </div>
  );
}

const TABS = [
  { id: 'tax',         label: '消費税' },
  { id: 'late',        label: '深夜料金' },
  { id: 'charge',      label: 'チャージ' },
  { id: 'crash',       label: '暴落' },
  { id: 'pricing',     label: '価格モデル' },
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

  const { data: settings, isLoading } = useQuery({
    queryKey: ['system-settings'],
    queryFn: api.getSystemSettings,
  });

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
                  <span>¥{yen(Math.round(1000 * lnPct / 100))}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>消費税（{taxPct}%）</span>
                  <span>¥{yen(Math.round((1000 + Math.round(1000 * lnPct / 100)) * taxPct / 100))}</span>
                </div>
                <div className="flex justify-between font-bold text-slate-900 pt-1 border-t border-amber-200 mt-1">
                  <span>合計（税込み）</span>
                  <span>
                    ¥{yen((
                      1000 +
                      Math.round(1000 * lnPct / 100) +
                      Math.round((1000 + Math.round(1000 * lnPct / 100)) * taxPct / 100)
                    ))}
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

          {/* ── 価格モデル ── */}
          {activeTab === 'pricing' && <PriceModelTab />}

          {/* ── ログ ── */}
          {activeTab === 'log' && <LogTab />}

          {/* ── メンテナンス ── */}
          {activeTab === 'maintenance' && <MaintenanceTab />}

          {/* ── 株価暴落 ── */}
          {activeTab === 'crash' && <CrashTab />}
        </>
      )}
    </div>
  );
}
