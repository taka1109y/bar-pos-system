import { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';

// ── DBに存在しない項目のゼロ値固定モック ─────────────────────
const MOCK_STATIC = {
  tsubu_count: 0,
  cancel_amount: 0, cancel_count: 0,
  correction_amount: 0, correction_count: 0,
  unsold: 0,
  register_open_cash_count: 0,
  deposit_count: 0,
  withdraw_count: 0,
  point_count: 0, point_amount: 0,
  kakeuri_count: 0, kakeuri_amount: 0,
  register_open_cash: 0,
};

const DIFF_REASONS = ['未選択', 'つり銭補充', '誤操作', '在高相違', 'その他'];

// ── 青テーマのスタイル定数 ──────────────────────────────────
const BLUE_HEADER = 'bg-sky-400 text-white';
const BLUE_BTN    = 'bg-sky-400 hover:bg-sky-500 active:bg-sky-600 text-white font-bold rounded transition-colors';
const INPUT_CLS   = 'w-full text-right text-xs tabular-nums border border-sky-400 rounded bg-white px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-sky-500';

// ── 精算レポート行 ──────────────────────────────────────────
function LRow({ label, value, sub, dot }) {
  return (
    <div className="flex items-start justify-between px-2 py-1.5 border-b border-slate-100 last:border-0 min-h-[32px]">
      <div className="flex items-center gap-1">
        {dot && <span className="text-sky-500 text-sm leading-none">●</span>}
        <span className="text-[11px] text-slate-600">{label}</span>
      </div>
      <div className="text-right">
        {value !== '' && value !== undefined && (
          <span className="text-[11px] font-bold text-slate-800 block tabular-nums">{value}</span>
        )}
        {sub && <span className="text-[10px] text-slate-400 block">{sub}</span>}
      </div>
    </div>
  );
}

// ── 実績入力: 通常行（入力 + 差異） ───────────────────────────
function IRow({ label, value, onChange, onBlur, diff, indent, readOnly }) {
  return (
    <div className={`flex items-center gap-1.5 px-3 py-1 border-b border-slate-100 last:border-0 min-h-[34px] ${indent ? 'bg-slate-50' : ''}`}>
      <span className={`flex-shrink-0 w-32 text-[11px] ${indent ? 'pl-3 text-slate-400' : 'text-slate-600'}`}>
        {indent && '└ '}{label}
      </span>
      {readOnly ? (
        <span className="flex-1 text-right text-[11px] text-slate-700 tabular-nums pr-1">
          ¥{Number(value || 0).toLocaleString()}
        </span>
      ) : (
        <div className="flex-1">
          <input
            type="text"
            inputMode="numeric"
            value={value}
            onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
            onBlur={onBlur}
            placeholder="¥0"
            className={INPUT_CLS}
          />
        </div>
      )}
      <span className={`flex-shrink-0 w-14 text-right text-[11px] tabular-nums ${
        diff === undefined || diff === 0 ? 'text-slate-400' : diff > 0 ? 'text-amber-600 font-bold' : 'text-red-600 font-bold'
      }`}>
        {diff !== undefined ? `¥${diff.toLocaleString()}` : ''}
      </span>
    </div>
  );
}

// ── 実績入力: ボタン付き行 ────────────────────────────────────
function IRowBtn({ label, value, onChange, btnLabel, onBtn, diff }) {
  return (
    <div className="flex items-center gap-1.5 px-3 py-1 border-b border-slate-100 last:border-0 min-h-[34px]">
      <span className="flex-shrink-0 w-32 text-[11px] text-slate-600">{label}</span>
      <div className="flex-1">
        <input
          type="text"
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
          placeholder="¥0"
          className={INPUT_CLS}
        />
      </div>
      <button onClick={onBtn} className={`${BLUE_BTN} flex-shrink-0 px-2.5 py-0.5 text-[11px]`}>
        {btnLabel}
      </button>
      <span className={`flex-shrink-0 w-14 text-right text-[11px] tabular-nums ${
        diff === undefined || diff === 0 ? 'text-slate-400' : diff > 0 ? 'text-amber-600 font-bold' : 'text-red-600 font-bold'
      }`}>
        {diff !== undefined ? `¥${diff.toLocaleString()}` : ''}
      </span>
    </div>
  );
}

// ── メインコンポーネント ─────────────────────────────────────
export default function RegisterClosePage() {
  const today = new Date().toISOString().split('T')[0];

  const { data: report, isLoading } = useQuery({
    queryKey: ['report-daily', today],
    queryFn: () => api.getDailyReport(today),
  });

  const { data: settings } = useQuery({
    queryKey: ['system-settings'],
    queryFn: () => api.getSystemSettings(),
  });

  // レジオープン時現金（手動入力・DB保持）
  const [openCashInput, setOpenCashInput] = useState('');
  const openCashInitialized = useRef(false);
  useEffect(() => {
    if (settings && !openCashInitialized.current) {
      setOpenCashInput(String(settings.register_open_cash ?? 0));
      openCashInitialized.current = true;
    }
  }, [settings]);

  const registerOpenCash = parseInt(openCashInput, 10) || 0;

  const handleOpenCashBlur = async () => {
    try {
      await api.updateSystemSettings({ register_open_cash: registerOpenCash });
    } catch (e) {
      console.error('レジオープン時現金の保存に失敗しました', e);
    }
  };

  // DBから取得した値（ロード中はゼロ値）
  const kenCount       = report?.order_count ?? 0;
  const guestCount     = report?.guest_count ?? 0;
  const avgPerGuest    = report?.avg_per_guest ?? 0;
  const sales          = report?.total_revenue ?? 0;
  const tax            = report?.total_tax ?? 0;
  const serviceCharge  = report?.total_charge ?? 0;
  const serviceCount   = report?.charge_count ?? 0;
  const lateNight      = report?.total_late_night ?? 0;
  const lateNightCount = report?.late_night_count ?? 0;
  const discountCount  = report?.discount_count ?? 0;

  const cashPay    = report?.payment_breakdown?.find(b => b.method === 'cash')   ?? { count: 0, revenue: 0 };
  const cardPay    = report?.payment_breakdown?.find(b => b.method === 'card')   ?? { count: 0, revenue: 0 };
  const emoneyPay  = report?.payment_breakdown?.find(b => b.method === 'emoney') ?? { count: 0, revenue: 0 };

  const giftNoChgAmount = report?.gift_no_change_amount ?? 0;
  const giftNoChgCount  = report?.gift_no_change_count  ?? 0;
  const giftChgAmount   = report?.gift_change_amount    ?? 0;
  const giftChgCount    = report?.gift_change_count     ?? 0;

  // DBにない項目はゼロ値固定
  const m = MOCK_STATIC;

  const [cashActual,      setCashActual]      = useState('');
  const [creditActual,    setCreditActual]    = useState('');
  const [pointActual,     setPointActual]     = useState('');
  const [emoneyActual,    setEmoneyActual]    = useState('');
  const [giftNoChg,       setGiftNoChg]       = useState('');
  const [giftChg,         setGiftChg]         = useState('');
  const [kakeuri,         setKakeuri]         = useState('');
  const [openFloat,       setOpenFloat]       = useState('');
  const [storeSaving,     setStoreSaving]     = useState('');
  const [bankTransfer,    setBankTransfer]    = useState('');
  const [diffReason,      setDiffReason]      = useState('未選択');

  const prevDaySaving = 0;

  // 差異 = 入力値 − システム値（現金在高 = オープン時現金 + 現金払い合計）
  const cashSystem   = registerOpenCash + cashPay.revenue;
  const cashDiff     = useMemo(() => cashActual   !== '' ? (parseInt(cashActual, 10)   || 0) - cashSystem       : 0, [cashActual, cashSystem]);
  const creditDiff   = useMemo(() => creditActual !== '' ? (parseInt(creditActual, 10) || 0) - cardPay.revenue  : 0, [creditActual, cardPay.revenue]);
  const pointDiff    = useMemo(() => pointActual  !== '' ? (parseInt(pointActual, 10)  || 0) - m.point_amount   : 0, [pointActual]);
  const emoneyDiff   = useMemo(() => emoneyActual !== '' ? (parseInt(emoneyActual, 10) || 0) - emoneyPay.revenue: 0, [emoneyActual, emoneyPay.revenue]);
  const giftNoChgDiff= useMemo(() => giftNoChg   !== '' ? (parseInt(giftNoChg, 10)    || 0) - giftNoChgAmount  : 0, [giftNoChg, giftNoChgAmount]);
  const giftChgDiff  = useMemo(() => giftChg     !== '' ? (parseInt(giftChg, 10)      || 0) - giftChgAmount    : 0, [giftChg, giftChgAmount]);
  const kakeuriDiff  = useMemo(() => kakeuri      !== '' ? (parseInt(kakeuri, 10)      || 0) - m.kakeuri_amount : 0, [kakeuri]);

  return (
    <div className="flex flex-col h-full bg-slate-100">
      {/* ── 2列コンテンツ ── */}
      <div className="flex-1 flex gap-0 overflow-hidden min-h-0 p-1.5 gap-1.5">

        {/* ══ 左列: 精算レポート ══ */}
        <div className="flex flex-col rounded-lg overflow-hidden shadow-sm bg-white" style={{ width: '44%' }}>
          {/* ヘッダー */}
          <div className={`flex items-center justify-between px-3 py-2 flex-shrink-0 ${BLUE_HEADER}`}>
            <h2 className="text-[13px] font-bold">精算レポート</h2>
            <button
              onClick={() => alert('入出金履歴機能は未実装です')}
              className="h-6 px-2.5 flex items-center text-[11px] font-bold rounded bg-white/20 hover:bg-white/30 transition-colors whitespace-nowrap"
            >
              入出金履歴
            </button>
          </div>

          {/* ローディング */}
          {isLoading ? (
            <div className="flex-1 flex items-center justify-center text-[12px] text-slate-400">
              読み込み中...
            </div>
          ) : (
            /* 2サブ列 */
            <div className="flex-1 flex overflow-hidden mx-2">
              {/* 左サブ列: 売上系 */}
              <div className="flex-1 overflow-y-auto border-r border-slate-100 pr-2">
                <LRow label="件数"           value={`${kenCount}件`} />
                <LRow label="客数"           value={`${guestCount}名様`} />
                <LRow label="客単価"         value={`¥${avgPerGuest.toLocaleString()}`} />
                <LRow label="粒売上点数"     value="" sub={`${m.tsubu_count}件`} />
                <LRow label="売上"           value={`¥${Math.floor(sales).toLocaleString()}`} />
                <LRow label="消費税"         value={`¥${Math.floor(tax).toLocaleString()}`} />
                <LRow label="売上・消費税 内訳" value="" />
                <LRow label="サービス料金"   value={`¥${Math.floor(serviceCharge).toLocaleString()}`} sub={`${serviceCount}件`} />
                <LRow label="深夜料金"       value={`¥${Math.floor(lateNight).toLocaleString()}`} sub={`${lateNightCount}件`} />
                <LRow label="値引引"         value="" sub={`${discountCount}件`} />
                <LRow label="取消（返品等）"  value={`¥${m.cancel_amount.toLocaleString()}`} sub={`${m.cancel_count}件`} />
                <LRow label="訂正（同品等）"  value={`¥${m.correction_amount.toLocaleString()}`} sub={`${m.correction_count}件`} />
                <LRow label="未売上"         value={`¥${m.unsold.toLocaleString()}`} />
              </div>

              {/* 右サブ列: 支払い系 */}
              <div className="flex-1 overflow-y-auto">
                <LRow label="レジオープン時現金" value="" sub={`${m.register_open_cash_count}件`} />
                <LRow label="入金"           value="" sub={`${m.deposit_count}件`} />
                <LRow label="出金"           value={`¥0`} sub={`${m.withdraw_count}件`} />
                <LRow label="現金"           value={`¥${Math.floor(cashPay.revenue).toLocaleString()}`}   sub={`${cashPay.count}件`} />
                <LRow label="クレジット"     value={`¥${Math.floor(cardPay.revenue).toLocaleString()}`}   sub={`${cardPay.count}件`} />
                <LRow label="ポイント"       value={`¥${m.point_amount.toLocaleString()}`}                sub={`${m.point_count}件`} />
                <LRow label="電子マネー"     value={`¥${Math.floor(emoneyPay.revenue).toLocaleString()}`} sub={`${emoneyPay.count}件`} />
                <LRow label="商品券（釣無し）" value={`¥${Math.floor(giftNoChgAmount).toLocaleString()}`} sub={`${giftNoChgCount}件`} />
                <LRow label="商品券（釣有り）" value={`¥${Math.floor(giftChgAmount).toLocaleString()}`}   sub={`${giftChgCount}件`} />
                <LRow label="掛売"           value={`¥${m.kakeuri_amount.toLocaleString()}`}              sub={`${m.kakeuri_count}件`} />
              </div>
            </div>
          )}
        </div>

        {/* ══ 右列: レジクローズ時レジ実績入力 ══ */}
        <div className="flex flex-col rounded-lg overflow-hidden shadow-sm bg-white ml-1" style={{ flex: 1 }}>
          {/* ヘッダー */}
          <div className={`flex items-center px-3 py-2 flex-shrink-0 ${BLUE_HEADER}`}>
            <span className="text-[12px] font-bold">レジクローズ時レジ実績入力</span>
          </div>

          {/* 差異ヘッダー */}
          <div className="flex items-center px-3 py-0.5 bg-slate-50 border-b border-slate-200 flex-shrink-0">
            <span className="flex-shrink-0 w-32" />
            <div className="flex-1" />
            <span className="flex-shrink-0 w-14" />
            <span className="flex-shrink-0 w-14 text-right text-[10px] font-bold text-slate-400 uppercase tracking-wider">差異</span>
          </div>

          {/* スクロール可能な入力エリア */}
          <div className="flex-1 overflow-y-auto mx-2">
            <IRow
              label="現金在高"
              value={cashActual}
              onChange={setCashActual}
              diff={cashDiff}
            />
            <IRow
              label="レジオープン時現金"
              value={openCashInput}
              onChange={setOpenCashInput}
              onBlur={handleOpenCashBlur}
              indent
            />
            <IRow label="クレジット"        value={creditActual}  onChange={setCreditActual}  diff={creditDiff} />
            <IRow label="ポイント"          value={pointActual}   onChange={setPointActual}   diff={pointDiff} />
            <IRow label="電子マネー"        value={emoneyActual}  onChange={setEmoneyActual}  diff={emoneyDiff} />
            <IRow label="商品券（釣:無し）"  value={giftNoChg}    onChange={setGiftNoChg}     diff={giftNoChgDiff} />
            <IRow label="商品券（釣:有り）"  value={giftChg}      onChange={setGiftChg}       diff={giftChgDiff} />
            <IRow label="掛売"              value={kakeuri}       onChange={setKakeuri}       diff={kakeuriDiff} />

            <IRowBtn
              label="開店準備金"
              value={openFloat}
              onChange={setOpenFloat}
              btnLabel="同額"
              onBtn={() => setOpenFloat(String(registerOpenCash))}
              diff={(parseInt(openFloat, 10) || 0) - 0}
            />
            <IRowBtn
              label="店舗保管金"
              value={storeSaving}
              onChange={setStoreSaving}
              btnLabel="抵込"
              onBtn={() => setStoreSaving(String(prevDaySaving))}
              diff={(parseInt(storeSaving, 10) || 0) - 0}
            />
            <IRow label="前日分" value={prevDaySaving} readOnly indent />

            <IRowBtn
              label="銀行振込"
              value={bankTransfer}
              onChange={setBankTransfer}
              btnLabel="札のみ"
              onBtn={() => setBankTransfer('0')}
            />

            {/* 差異理由 */}
            <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-slate-100">
              <span className="flex-shrink-0 w-32 text-[11px] text-slate-600">差異理由</span>
              <div className="relative flex-1">
                <select
                  value={diffReason}
                  onChange={(e) => setDiffReason(e.target.value)}
                  className="w-full appearance-none pl-2 pr-7 py-1 text-[11px] border border-slate-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-sky-400"
                >
                  {DIFF_REASONS.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
                <svg className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </div>
              {/* 差異列の幅合わせ */}
              <span className="flex-shrink-0 w-14" />
            </div>

            {/* 確定ボタン */}
            <div className="p-3">
              <button
                onClick={() => alert('確定機能は未実装です')}
                className={`w-full py-2.5 text-[13px] font-black rounded-lg ${BLUE_BTN}`}
              >
                確定
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── 下部アクションバー ── */}
      <div className="flex-shrink-0 bg-white border-t border-slate-200 px-3 py-2 flex items-center gap-2">
        <button
          onClick={() => alert('点検機能は未実装です')}
          className={`inline-flex items-center justify-center gap-1.5 h-9 px-5 text-[12px] rounded-lg ${BLUE_BTN}`}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
            <rect x="9" y="3" width="6" height="4" rx="1"/>
            <polyline points="9 12 11 14 15 10"/>
          </svg>
          点検
        </button>
      </div>
    </div>
  );
}
