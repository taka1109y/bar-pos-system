import { useState, useEffect } from 'react';
import { yen } from '../utils/format';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import Section from './settings/Section';
import CrashTab from './settings/CrashTab';
import MaintenanceTab from './settings/MaintenanceTab';
import { Button, Field, Input, Select, Segmented, Badge, Tabs, Toolbar, FilterBar, Alert, StatTile, DataTable } from '../components/ui';

const RECEIPT_LABELS = { normal: '通常', red: '赤伝票', void: '取消', black_cancelled: '黒取消' };
const RECEIPT_TONE = { normal: 'neutral', red: 'danger', void: 'warning', black_cancelled: 'neutral' };
const PAYMENT_LABELS = { cash: '現金', card: 'カード', emoney: '電子マネー', split: '分割' };
const LOG_LIMIT = 50;

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

// ── ログ(会計ログ検索) ──
function LogTab() {
  const today        = new Date().toISOString().slice(0, 10);
  const defaultFrom  = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  const [from,          setFrom]          = useState(defaultFrom);
  const [to,            setTo]            = useState(today);
  const [receiptType,   setReceiptType]   = useState('all');
  const [paymentMethod, setPaymentMethod] = useState('all');
  const [page,          setPage]          = useState(0);

  const [queryParams, setQueryParams] = useState({
    from: defaultFrom, to: today, receipt_type: 'all', payment_method: 'all', limit: LOG_LIMIT, offset: 0,
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

  return (
    <div className="space-y-4">
      <Section>
        <FilterBar>
          <Field label="開始日"><Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="終了日"><Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
          <Field label="伝票種別">
            <Select value={receiptType} onChange={(e) => setReceiptType(e.target.value)} options={[
              { value: 'all', label: '全て' }, { value: 'normal', label: '通常' }, { value: 'red', label: '赤伝票' }, { value: 'void', label: '取消' }, { value: 'black_cancelled', label: '黒取消' },
            ]} />
          </Field>
          <Field label="支払方法">
            <Select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} options={[
              { value: 'all', label: '全て' }, { value: 'cash', label: '現金' }, { value: 'card', label: 'カード' }, { value: 'emoney', label: '電子マネー' }, { value: 'split', label: '分割' },
            ]} />
          </Field>
          <Button loading={isFetching} onClick={handleSearch}>検索</Button>
        </FilterBar>
      </Section>

      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-heading">{isFetching ? '読み込み中...' : `${yen(total)} 件`}</p>
        {totalPages > 1 && (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Button variant="secondary" size="sm" iconOnly aria-label="前のページ" disabled={page === 0} onClick={() => handlePage(page - 1)}>‹</Button>
            <span>{page + 1} / {totalPages}</span>
            <Button variant="secondary" size="sm" iconOnly aria-label="次のページ" disabled={page + 1 >= totalPages} onClick={() => handlePage(page + 1)}>›</Button>
          </div>
        )}
      </div>

      <DataTable
        rowKey={(o) => o.id}
        empty={<div className="py-12 text-center text-sm text-muted">{isFetching ? '読み込み中...' : '該当データがありません'}</div>}
        columns={[
          { key: 'id', header: 'ID', render: (o) => <span className="text-faint">#{o.id}</span> },
          { key: 'dt', header: '会計日時', render: (o) => <span className="whitespace-nowrap text-heading">{fmtDateTime(o.closed_at)}</span> },
          { key: 'table', header: 'テーブル', render: (o) => o.table_name ?? '-' },
          { key: 'pay', header: '支払', render: (o) => o.payment_method === 'split'
            ? (<div><span className="font-medium">分割</span><span className="block text-2xs text-muted">{splitBreakdown(o)}</span></div>)
            : (PAYMENT_LABELS[o.payment_method] ?? o.payment_method) },
          { key: 'type', header: '種別', render: (o) => <Badge tone={RECEIPT_TONE[o.receipt_type] ?? 'neutral'} size="sm">{RECEIPT_LABELS[o.receipt_type] ?? o.receipt_type}</Badge> },
          { key: 'total', header: '合計', align: 'right', render: (o) => <span className={`font-medium tabular-nums ${o.receipt_type === 'void' || o.receipt_type === 'black_cancelled' ? 'text-red-600' : 'text-heading'}`}>¥{yen(o.total_amount)}</span> },
          { key: 'disc', header: '割引', align: 'right', render: (o) => <span className="text-muted tabular-nums">{o.discount_amount > 0 ? `¥${yen(o.discount_amount)}` : '-'}</span> },
          { key: 'memo', header: '備考', render: (o) => <span className="text-muted max-w-[10rem] truncate block">{o.memo ?? '-'}</span> },
        ]}
        rows={orders}
      />
    </div>
  );
}

function hourLabel(h) { return h < 24 ? `${h}:00` : `翌${h - 24}:00`; }
const HOUR_OPTIONS = Array.from({ length: 33 }, (_, i) => i); // 0–32

function NumberPctInput({ value, onChange }) {
  return (
    <div className="flex items-center gap-2">
      <Input type="number" min="0" max="100" step="1" className="w-20 text-right" value={value} onChange={(e) => onChange(e.target.value)} />
      <span className="text-sm text-muted">%</span>
    </div>
  );
}
function HourSelect({ value, onChange, className }) {
  return <Select className={className || 'w-32'} value={value} onChange={(e) => onChange(Number(e.target.value))} options={HOUR_OPTIONS.map((h) => ({ value: h, label: hourLabel(h) }))} />;
}

function remainMMSS(iso, nowMs) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - nowMs;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const total = Math.floor(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// ── 価格モデル(呼値ラダー＋期の状態表示 + 寄り付き + 値引き上限) ──
function PriceModelTab() {
  const [now, setNow] = useState(0);
  const { data: settings, isLoading } = useQuery({
    queryKey: ['system-settings'], queryFn: api.getSystemSettings, staleTime: 0, refetchInterval: 10_000,
  });
  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

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

  const [capInput, setCapInput] = useState(null);
  const [capMsg, setCapMsg] = useState('');
  const saveCapMutation = useMutation({
    mutationFn: (v) => api.updateSystemSettings({ monthly_discount_cap: v }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['system-settings'] }); setCapMsg('保存しました'); setTimeout(() => setCapMsg(''), 3000); },
    onError: () => { setCapMsg('エラーが発生しました'); setTimeout(() => setCapMsg(''), 3000); },
  });

  if (isLoading || !settings) return <p className="text-sm text-muted">読み込み中...</p>;

  const model         = settings.price_model ?? {};
  const periodMinutes = model.period_minutes ?? 15;
  const ladderSteps   = model.ladder_steps   ?? 12;
  const periodRemain  = now > 0 ? remainMMSS(settings.period_ends_at, now) : null;
  const crashRemain   = now > 0 ? remainMMSS(settings.crash_ends_at, now) : null;
  const isCrashing    = crashRemain !== null;

  return (
    <div className="space-y-4">
      <Alert tone="info">
        価格は各商品ごとの下限〜上限を{ladderSteps}段に刻んだ「呼値ラダー」を、{periodMinutes}分ごとの「期」で上下します。
        注文が入ると即時に1段上昇、期内に注文がなければ1段下降します。下限／上限とラダーは基準価格・原価から自動計算され、商品ごとに設定します（商品管理で確認）。
      </Alert>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile label="期の長さ" value={`${periodMinutes} 分`} sub="注文がなければ1段下降" />
        <StatTile label="ラダー段数" value={`${ladderSteps} 段`} sub="下限〜上限を刻む段数" />
        <StatTile label="現在の期の残り" value={periodRemain ?? '—'} sub={periodRemain ? '次の変動までの時間' : '待機中'} />
        <StatTile label="暴落状態" value={isCrashing ? `残り ${crashRemain}` : '通常'} sub={isCrashing ? '最下段へ急落中' : '発生していません'} deltaTone={isCrashing ? 'down' : 'neutral'} delta={isCrashing ? '暴落中' : null} />
      </div>

      <Section title="手動 寄り付きリセット（例外用）" desc="通常はレジオープン時に自動実行されます。全ての変動対象銘柄を寄り付き値（基準価格×1.1）へ戻し、期の起点を今に合わせます。">
        <div className="flex items-center gap-3">
          <Button loading={marketOpenMutation.isPending}
            onClick={() => { if (window.confirm('全ての変動対象銘柄を寄り付き値へ戻します。よろしいですか？')) marketOpenMutation.mutate(); }}>
            寄り付きリセットを実行
          </Button>
          {openMsg && <span className="text-xs text-emerald-700">{openMsg}</span>}
        </div>
      </Section>

      <Section title="月次 値引き費用の上限（暴落原資）" desc="値引き費用（約定＜定価の合計）の月次上限。0 で無効。超過すると売上管理の「値引き費用」カードに警告が出ます。">
        <div className="flex items-end gap-3">
          <Field label="上限（円 / 0=無効）">
            <Input type="number" min={0} step={1000} className="w-40 text-right" value={capInput ?? settings.monthly_discount_cap ?? 0} onChange={(e) => setCapInput(e.target.value)} />
          </Field>
          <Button loading={saveCapMutation.isPending}
            onClick={() => saveCapMutation.mutate(Math.max(0, parseInt(capInput ?? settings.monthly_discount_cap ?? 0, 10) || 0))}>保存</Button>
          {capMsg && <span className="text-xs text-emerald-700 pb-2">{capMsg}</span>}
        </div>
      </Section>

      <p className="text-xs text-muted">※ この画面は状態確認用です。暴落の発動／解除は下の「暴落」、商品ごとの価格レンジは「商品管理」で操作します。</p>
    </div>
  );
}

const TABS = [
  { id: 'fees',        label: '料金・税' },
  { id: 'pricing',     label: 'プライシング' },
  { id: 'log',         label: 'ログ' },
  { id: 'maintenance', label: 'メンテナンス' },
];

export default function SystemSettingsPage() {
  const queryClient = useQueryClient();

  const [activeTab,          setActiveTab]          = useState('fees');
  const [taxInput,           setTaxInput]           = useState('');
  const [reducedTaxInput,    setReducedTaxInput]    = useState('');
  const [defaultTaxCategory, setDefaultTaxCategory] = useState('standard');
  const [lnRate,             setLnRate]             = useState('');
  const [lnStart,            setLnStart]            = useState(22);
  const [lnEnd,              setLnEnd]              = useState(29);
  const [savedTax,           setSavedTax]           = useState(false);
  const [savedLn,            setSavedLn]            = useState(false);
  const [chargeEnabled,      setChargeEnabled]      = useState(true);
  const [chargeSlots,        setChargeSlots]        = useState([]);
  const [savedCharge,        setSavedCharge]        = useState(false);

  const { data: settings, isLoading } = useQuery({ queryKey: ['system-settings'], queryFn: api.getSystemSettings });

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
    const pct = parseFloat(taxInput);
    const reducedPct = parseFloat(reducedTaxInput);
    if (isNaN(pct) || pct < 0 || pct > 100) return;
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
  const addSlot    = () => setChargeSlots((prev) => [...prev, { label: '', start: 17, end: 23, amount: 500 }]);
  const updateSlot = (i, key, val) => setChargeSlots((prev) => prev.map((s, idx) => idx === i ? { ...s, [key]: val } : s));
  const removeSlot = (i) => setChargeSlots((prev) => prev.filter((_, idx) => idx !== i));

  const saveBtn = (saved, onClick) => (
    <Button variant={saved ? 'success' : 'primary'} loading={saveMutation.isPending} onClick={onClick}>{saved ? '保存しました' : '保存'}</Button>
  );

  const taxPct = parseFloat(taxInput) || 0;
  const lnPct  = parseFloat(lnRate)   || 0;

  return (
    <div className="ui-pad p-4 md:p-6 space-y-4">
      <Toolbar title="システム管理" subtitle="消費税・料金・価格エンジン・ログ・メンテナンス" />
      <Tabs activeId={activeTab} onChange={setActiveTab} tabs={TABS} />

      {isLoading ? (
        <p className="text-sm text-muted">読み込み中...</p>
      ) : (
        <>
          {/* ── 料金・税(消費税 + 深夜料金 + チャージ) ── */}
          {activeTab === 'fees' && (
            <div className="space-y-4">
              <Section title="消費税設定" desc="会計時に適用される消費税率。商品ごとに標準・軽減を選択できます。">
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="標準税率（%）"><NumberPctInput value={taxInput} onChange={setTaxInput} /></Field>
                    <Field label="軽減税率（%）"><NumberPctInput value={reducedTaxInput} onChange={setReducedTaxInput} /></Field>
                  </div>
                  <Field label="新規商品のデフォルト税率区分">
                    <Segmented className="w-full max-w-md [&>button]:flex-1" value={defaultTaxCategory} onChange={setDefaultTaxCategory}
                      options={[{ value: 'standard', label: `標準（${taxInput}%）` }, { value: 'reduced', label: `軽減（${reducedTaxInput}%）` }]} />
                  </Field>
                  <div className="flex justify-end">{saveBtn(savedTax, handleSaveTax)}</div>
                  {savedTax && <Alert tone="success">保存しました</Alert>}
                </div>
              </Section>

              <Section title="深夜料金設定" desc="指定時間帯の会計に加算される料金。開始・終了時刻は32時間制で入力（例: 翌3時 = 27）。">
                <div className="space-y-4">
                  <Field label="深夜料金率（%）"><NumberPctInput value={lnRate} onChange={setLnRate} /></Field>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="開始時刻"><HourSelect value={lnStart} onChange={setLnStart} /></Field>
                    <Field label="終了時刻"><HourSelect value={lnEnd} onChange={setLnEnd} /></Field>
                  </div>
                  {lnStart >= lnEnd && <p className="text-xs text-danger">終了時刻は開始時刻より後にしてください</p>}
                  <div className="flex justify-end">{saveBtn(savedLn, handleSaveLn)}</div>
                  {savedLn && <Alert tone="success">保存しました</Alert>}
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm space-y-1">
                    <p className="text-xs font-medium text-amber-700 mb-2">計算例（¥1,000 · {hourLabel(lnStart)}〜{hourLabel(lnEnd)} の会計）</p>
                    <div className="flex justify-between text-amber-700"><span>小計（税抜き）</span><span>¥1,000</span></div>
                    <div className="flex justify-between text-amber-700"><span>深夜料金（{lnPct}%）</span><span>¥{yen(Math.round(1000 * lnPct / 100))}</span></div>
                    <div className="flex justify-between text-body"><span>消費税（{taxPct}%）</span><span>¥{yen(Math.round((1000 + Math.round(1000 * lnPct / 100)) * taxPct / 100))}</span></div>
                    <div className="flex justify-between font-bold text-heading pt-1 border-t border-amber-200 mt-1">
                      <span>合計（税込み）</span>
                      <span>¥{yen((1000 + Math.round(1000 * lnPct / 100) + Math.round((1000 + Math.round(1000 * lnPct / 100)) * taxPct / 100)))}</span>
                    </div>
                  </div>
                </div>
              </Section>

              <Section title="チャージ設定" desc="入店時に人数×料金を自動で注文に追加します。時間帯ごとに料金を設定できます。">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-heading">チャージを有効にする</p>
                      <p className="text-xs text-muted mt-0.5">無効にするとチャージは発生しません</p>
                    </div>
                    <button type="button" onClick={() => setChargeEnabled((v) => !v)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${chargeEnabled ? 'bg-primary-500' : 'bg-slate-300'}`} aria-pressed={chargeEnabled}>
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${chargeEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                  </div>

                  <div>
                    <p className="text-xs font-semibold text-muted mb-2">時間帯別料金（人数 × 料金/人）</p>
                    {chargeSlots.length === 0 && <p className="text-xs text-muted py-2">時間帯が設定されていません（チャージなし）</p>}
                    <div className="space-y-2">
                      {chargeSlots.map((slot, i) => (
                        <div key={i} className="bg-surface-sunken rounded-lg border border-line p-3 space-y-2">
                          <div className="flex items-center gap-2">
                            <Input className="flex-1" placeholder="ラベル（例: ハッピーアワー）" value={slot.label ?? ''} onChange={(e) => updateSlot(i, 'label', e.target.value)} />
                            <Button variant="secondary" size="md" iconOnly aria-label="この時間帯を削除" className="text-danger border-red-200 hover:bg-red-50" onClick={() => removeSlot(i)}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                            </Button>
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <Field label="開始"><HourSelect value={slot.start} onChange={(v) => updateSlot(i, 'start', v)} className="w-28" /></Field>
                            <span className="text-muted text-sm mt-5">〜</span>
                            <Field label="終了"><HourSelect value={slot.end} onChange={(v) => updateSlot(i, 'end', v)} className="w-28" /></Field>
                            <Field label="料金/人（円）"><Input type="number" min="0" step="100" prefix="¥" className="w-28 text-right" value={slot.amount} onChange={(e) => updateSlot(i, 'amount', parseInt(e.target.value) || 0)} /></Field>
                          </div>
                          {slot.start >= slot.end && <p className="text-2xs text-danger">終了時刻は開始より後にしてください</p>}
                        </div>
                      ))}
                    </div>
                    <Button variant="secondary" size="sm" className="mt-2" onClick={addSlot}>＋ 時間帯を追加</Button>
                  </div>

                  <div className="flex justify-end">{saveBtn(savedCharge, handleSaveCharge)}</div>
                  {savedCharge && <Alert tone="success">保存しました</Alert>}
                </div>
              </Section>
            </div>
          )}

          {/* ── プライシング(価格モデル + 暴落) ── */}
          {activeTab === 'pricing' && (
            <div className="space-y-4">
              <PriceModelTab />
              <CrashTab />
            </div>
          )}

          {/* ── ログ ── */}
          {activeTab === 'log' && <LogTab />}

          {/* ── メンテナンス ── */}
          {activeTab === 'maintenance' && <MaintenanceTab />}
        </>
      )}
    </div>
  );
}
