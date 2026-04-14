import { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import CashDenomModal from '../components/pos/CashDenomModal';

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
function IRow({ label, value, onChange, onBlur, diff, indent, readOnly, onClick }) {
  return (
    <div
      className={`flex items-center gap-1.5 px-3 py-1 border-b border-slate-100 last:border-0 min-h-[34px] ${indent ? 'bg-slate-50' : ''} ${onClick ? 'cursor-pointer hover:bg-sky-50 transition-colors' : ''}`}
      onClick={onClick}
    >
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

// ── レジクローズ確認ダイアログ ───────────────────────────────
function CloseConfirmDialog({ onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
      <div className="bg-white rounded-xl shadow-xl overflow-hidden w-80">
        <div className="bg-sky-400 text-white px-4 py-3">
          <h3 className="text-[14px] font-bold">レジクローズ確認</h3>
        </div>
        <div className="px-5 py-5">
          <p className="text-[13px] text-slate-700 text-center mb-6">
            レジクローズしますか？
          </p>
          <div className="flex gap-3">
            <button
              onClick={onCancel}
              className="flex-1 py-2.5 text-[13px] font-bold border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
            >
              いいえ
            </button>
            <button
              onClick={onConfirm}
              className="flex-1 py-2.5 text-[13px] font-bold rounded-lg bg-sky-400 hover:bg-sky-500 active:bg-sky-600 text-white transition-colors"
            >
              はい
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── メインコンポーネント ─────────────────────────────────────
export default function RegisterClosePage() {
  const today       = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  const navigate    = useNavigate();
  const queryClient = useQueryClient();

  const { data: settings } = useQuery({
    queryKey: ['system-settings'],
    queryFn: () => api.getSystemSettings(),
  });

  const { data: report, isLoading } = useQuery({
    queryKey: ['report-daily', today, settings?.register_opened_at],
    queryFn: () => api.getDailyReport(today, settings?.register_opened_at ?? null),
    enabled: !!settings,
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

  // 現金在高 = レジオープン時現金 + 現金支払い合計（システム期待値）
  const cashSystem = registerOpenCash + cashPay.revenue;

  // 金種入力モーダル
  const [showDenomModal,   setShowDenomModal]   = useState(false);
  const [denomCounts,      setDenomCounts]      = useState({});
  const [cashActual,       setCashActual]        = useState(null);

  const hasDenomInput = cashActual !== null;
  const cashDiff      = useMemo(
    () => hasDenomInput ? cashActual - cashSystem : undefined,
    [cashActual, cashSystem, hasDenomInput]
  );

  const handleDenomChange   = (denomValue, count) => setDenomCounts(prev => ({ ...prev, [denomValue]: count }));
  const handleDenomConfirm  = (total) => { setCashActual(total); setShowDenomModal(false); };
  const handleDenomCancel   = () => setShowDenomModal(false);

  // レジクローズ確認ダイアログ
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  const handleCloseConfirm = async () => {
    try {
      await api.updateSystemSettings({ register_open: false });
      queryClient.invalidateQueries({ queryKey: ['system-settings'] });
      navigate('/start');
    } catch (e) {
      console.error('レジクローズに失敗しました', e);
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-100">
      {/* ── 2列コンテンツ ── */}
      <div className="flex-1 flex gap-0 overflow-hidden min-h-0 p-1.5 gap-1.5">

        {/* ══ 左列: 精算レポート ══ */}
        <div className="flex flex-col rounded-lg overflow-hidden shadow-sm bg-white" style={{ width: '44%' }}>
          <div className={`flex items-center justify-between px-3 py-2 flex-shrink-0 ${BLUE_HEADER}`}>
            <h2 className="text-[13px] font-bold">精算レポート</h2>
            <button
              onClick={() => alert('入出金履歴機能は未実装です')}
              className="h-6 px-2.5 flex items-center text-[11px] font-bold rounded bg-white/20 hover:bg-white/30 transition-colors whitespace-nowrap"
            >
              入出金履歴
            </button>
          </div>

          {isLoading ? (
            <div className="flex-1 flex items-center justify-center text-[12px] text-slate-400">
              読み込み中...
            </div>
          ) : (
            <div className="flex-1 flex overflow-hidden mx-2">
              <div className="flex-1 overflow-y-auto border-r border-slate-100 pr-2">
                <LRow label="件数"             value={`${kenCount}件`} />
                <LRow label="客数"             value={`${guestCount}名様`} />
                <LRow label="客単価"           value={`¥${avgPerGuest.toLocaleString()}`} />
                <LRow label="総売上点数"       value="" sub={`${m.tsubu_count}件`} />
                <LRow label="売上"             value={`¥${Math.floor(sales).toLocaleString()}`} />
                <LRow label="消費税"           value={`¥${Math.floor(tax).toLocaleString()}`} />
                <LRow label="売上・消費税 内訳" value="" />
                <LRow label="サービス料金"     value={`¥${Math.floor(serviceCharge).toLocaleString()}`} sub={`${serviceCount}件`} />
                <LRow label="深夜料金"         value={`¥${Math.floor(lateNight).toLocaleString()}`} sub={`${lateNightCount}件`} />
                <LRow label="値割引"           value="" sub={`${discountCount}件`} />
                <LRow label="取消（赤伝票）"    value={`¥${m.cancel_amount.toLocaleString()}`} sub={`${m.cancel_count}件`} />
                <LRow label="訂正（黒伝票）"    value={`¥${m.correction_amount.toLocaleString()}`} sub={`${m.correction_count}件`} />
                <LRow label="未回収"           value={`¥${m.unsold.toLocaleString()}`} />
              </div>
              <div className="flex-1 overflow-y-auto">
                <LRow label="レジオープン時現金" value="" sub={`${m.register_open_cash_count}件`} />
                <LRow label="入金"             value="" sub={`${m.deposit_count}件`} />
                <LRow label="出金"             value="¥0" sub={`${m.withdraw_count}件`} />
                <LRow label="現金"             value={`¥${Math.floor(cashPay.revenue).toLocaleString()}`}   sub={`${cashPay.count}件`} />
                <LRow label="クレジット"       value={`¥${Math.floor(cardPay.revenue).toLocaleString()}`}   sub={`${cardPay.count}件`} />
                <LRow label="ポイント"         value={`¥${m.point_amount.toLocaleString()}`}                sub={`${m.point_count}件`} />
                <LRow label="電子マネー"       value={`¥${Math.floor(emoneyPay.revenue).toLocaleString()}`} sub={`${emoneyPay.count}件`} />
                <LRow label="商品券（釣無し）"  value={`¥${Math.floor(giftNoChgAmount).toLocaleString()}`}  sub={`${giftNoChgCount}件`} />
                <LRow label="商品券（釣有り）"  value={`¥${Math.floor(giftChgAmount).toLocaleString()}`}    sub={`${giftChgCount}件`} />
                <LRow label="掛売"             value={`¥${m.kakeuri_amount.toLocaleString()}`}              sub={`${m.kakeuri_count}件`} />
              </div>
            </div>
          )}
        </div>

        {/* ══ 右列: レジクローズ時レジ実績入力 ══ */}
        <div className="flex flex-col rounded-lg overflow-hidden shadow-sm bg-white ml-1" style={{ flex: 1 }}>
          <div className={`flex items-center px-3 py-2 flex-shrink-0 ${BLUE_HEADER}`}>
            <span className="text-[12px] font-bold">レジクローズ時レジ実績入力</span>
          </div>

          <div className="flex items-center px-3 py-0.5 bg-slate-50 border-b border-slate-200 flex-shrink-0">
            <span className="flex-shrink-0 w-32" />
            <div className="flex-1" />
            <span className="flex-shrink-0 w-14" />
            <span className="flex-shrink-0 w-14 text-right text-[10px] font-bold text-slate-400 uppercase tracking-wider">差異</span>
          </div>

          <div className="flex-1 overflow-y-auto mx-2">
            <IRow
              label="現金在高"
              value={hasDenomInput ? cashActual : cashSystem}
              readOnly
              diff={cashDiff}
              onClick={() => setShowDenomModal(true)}
            />
            <IRow
              label="レジオープン時現金"
              value={openCashInput}
              onChange={setOpenCashInput}
              onBlur={handleOpenCashBlur}
              indent
            />

            {/* 確定ボタン */}
            <div className="p-3">
              <button
                onClick={() => setShowCloseConfirm(true)}
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

      {/* ── 金種入力モーダル ── */}
      {showDenomModal && (
        <CashDenomModal
          denomCounts={denomCounts}
          onChange={handleDenomChange}
          onConfirm={handleDenomConfirm}
          onCancel={handleDenomCancel}
        />
      )}

      {/* ── レジクローズ確認ダイアログ ── */}
      {showCloseConfirm && (
        <CloseConfirmDialog
          onConfirm={handleCloseConfirm}
          onCancel={() => setShowCloseConfirm(false)}
        />
      )}
    </div>
  );
}
