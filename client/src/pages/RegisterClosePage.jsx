import { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import CashDenomModal from '../components/pos/CashDenomModal';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { exportReceiptsPdf } from '../utils/receiptsPdfExport';
import { TZ } from '../utils/tz';

// ── DBに存在しない項目のゼロ値固定モック ─────────────────────
const MOCK_STATIC = {
  tsubu_count: 0,
  unsold: 0,
  register_open_cash_count: 0,
  deposit_count: 0,
  withdraw_count: 0,
  point_count: 0, point_amount: 0,
  kakeuri_count: 0, kakeuri_amount: 0,
  register_open_cash: 0,
};

// ── 青テーマのスタイル定数 ──────────────────────────────────
const BLUE_HEADER = 'bg-primary-500 text-white';
const BLUE_BTN    = 'bg-primary-500 hover:bg-primary-600 active:bg-primary-700 text-white font-bold rounded transition-colors';
const INPUT_CLS   = 'w-full text-right text-sm tabular-nums border border-slate-300 rounded bg-white px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-primary-500/50';

// ── PDF出力用行（インラインスタイル・html2canvas用） ────────────
function PRow({ label, value, sub, indent, dot }) {
  return (
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start',
      padding:'4px 8px', borderBottom:'1px solid #f1f5f9', minHeight:'26px',
      background: indent ? '#f8fafc' : 'transparent' }}>
      <span style={{ color:'#475569', fontSize:'11px' }}>
        {dot && <span style={{ color:'#2b70ef', marginRight:'4px', fontSize:'9px' }}>●</span>}
        {label}
      </span>
      <div style={{ textAlign:'right' }}>
        {value !== undefined && value !== '' && (
          <span style={{ fontWeight:700, color:'#1e293b', fontSize:'11px', display:'block' }}>{value}</span>
        )}
        {sub && <div style={{ fontSize:'9px', color:'#94a3b8' }}>{sub}</div>}
      </div>
    </div>
  );
}

// ── 精算レポート行 ──────────────────────────────────────────
function LRow({ label, value, sub, dot }) {
  return (
    <div className="flex items-start justify-between px-2 py-1.5 border-b border-slate-100 last:border-0 min-h-[32px]">
      <div className="flex items-center gap-1">
        {dot && <span className="text-primary-500 text-base leading-none">●</span>}
        <span className="text-[13px] text-slate-600">{label}</span>
      </div>
      <div className="text-right">
        {value !== '' && value !== undefined && (
          <span className="text-[13px] font-bold text-slate-800 block tabular-nums">{value}</span>
        )}
        {sub && <span className="text-[12px] text-slate-400 block">{sub}</span>}
      </div>
    </div>
  );
}

// ── 実績入力: 通常行（入力 + 差異） ───────────────────────────
function IRow({ label, value, onChange, onBlur, diff, indent, readOnly, onClick }) {
  return (
    <div
      className={`flex items-center gap-1.5 px-3 py-1 border-b border-slate-100 last:border-0 min-h-[34px] ${indent ? 'bg-slate-50' : ''} ${onClick ? 'cursor-pointer hover:bg-primary-500 transition-colors' : ''}`}
      onClick={onClick}
    >
      <span className={`flex-shrink-0 w-24 text-[13px] ${indent ? 'pl-3 text-slate-400' : 'text-slate-600'}`}>
        {indent && '└ '}{label}
      </span>
      {readOnly ? (
        <span className="flex-1 text-right text-[13px] text-slate-700 tabular-nums pr-1">
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
      <span className={`flex-shrink-0 w-14 text-right text-[13px] tabular-nums ${
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
        <div className="bg-primary-500 text-white px-4 py-3">
          <h3 className="text-[16px] font-bold">レジクローズ確認</h3>
        </div>
        <div className="px-5 py-5">
          <p className="text-[15px] text-slate-700 text-center mb-6">
            レジクローズしますか？
          </p>
          <div className="flex gap-3">
            <button
              onClick={onCancel}
              className="flex-1 py-4 text-[15px] font-bold border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
            >
              いいえ
            </button>
            <button
              onClick={onConfirm}
              className="flex-1 py-4 text-[15px] font-bold rounded-lg bg-primary-500 hover:bg-primary-600 active:bg-primary-700 text-white transition-colors"
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
  const today       = new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
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

  const { data: todayReceipts = [] } = useQuery({
    queryKey: ['receipts', today],
    queryFn: () => api.getReceipts(today),
  });

  const { data: openOrders = [] } = useQuery({
    queryKey: ['orders-open'],
    queryFn: api.getOpenOrders,
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
  const totalItemCount = report?.total_item_count ?? 0;
  const cancelAmount     = report?.cancel_amount     ?? 0;
  const cancelCount      = report?.cancel_count      ?? 0;
  const correctionAmount = report?.correction_amount ?? 0;
  const correctionCount  = report?.correction_count  ?? 0;

  const cashPay    = report?.payment_breakdown?.find(b => b.method === 'cash')   ?? { count: 0, revenue: 0 };
  const cardPay    = report?.payment_breakdown?.find(b => b.method === 'card')   ?? { count: 0, revenue: 0 };
  const emoneyPay  = report?.payment_breakdown?.find(b => b.method === 'emoney') ?? { count: 0, revenue: 0 };

  const giftNoChgAmount = report?.gift_no_change_amount ?? 0;
  const giftNoChgCount  = report?.gift_no_change_count  ?? 0;
  const giftChgAmount   = report?.gift_change_amount    ?? 0;
  const giftChgCount    = report?.gift_change_count     ?? 0;

  // 税率別課税対象額
  const taxableStandard = report?.taxable_standard ?? 0;
  const taxableReduced  = report?.taxable_reduced  ?? 0;
  const taxRateNum      = settings?.tax_rate         ?? 0.10;
  const reducedRateNum  = settings?.reduced_tax_rate ?? 0.08;
  const stdTax  = Math.round(taxableStandard * taxRateNum / (1 + taxRateNum));
  const redTax  = Math.round(taxableReduced  * reducedRateNum / (1 + reducedRateNum));
  const junSales = Math.floor(sales - tax);

  // 消費税内訳トグル
  const [showTaxDetail, setShowTaxDetail] = useState(false);

  // PDF生成中フラグ
  const [pdfGenerating, setPdfGenerating] = useState(false);
  const [pdfTimestamp,  setPdfTimestamp]  = useState('');
  const reportPdfRef = useRef(null);

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

  // PDF出力確認ダイアログ
  const [showPdfConfirm, setShowPdfConfirm] = useState(false);

  // レジクローズ確認ダイアログ
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [closeError,       setCloseError]       = useState(null);

  const handleCloseAttempt = () => {
    if (openOrders.length > 0) {
      setCloseError(`未会計のテーブルが ${openOrders.length} 件あります。会計を完了してからレジクローズしてください。`);
      return;
    }
    if (!pdfTimestamp) {
      setCloseError('レポートを未出力です。レポートを出力してからレジクローズを実施してください。');
      return;
    }
    setCloseError(null);
    setShowCloseConfirm(true);
  };

  const handleCloseConfirm = async () => {
    try {
      await api.updateSystemSettings({ register_open: false });
      queryClient.invalidateQueries({ queryKey: ['system-settings'] });
      navigate('/start');
    } catch (e) {
      console.error('レジクローズに失敗しました', e);
    }
  };

  const handlePdfExport = async () => {
    if (pdfGenerating || !reportPdfRef.current) return;
    setPdfGenerating(true);
    const ts = new Date().toLocaleString('ja-JP', { timeZone: TZ });
    setPdfTimestamp(ts);
    try {
      // React の再レンダリング（タイムスタンプ反映）を待つ
      await new Promise((r) => setTimeout(r, 300));

      // body 直下にクローンして親の overflow: hidden による clipping を回避
      const clone = reportPdfRef.current.cloneNode(true);
      clone.style.position = 'absolute';
      clone.style.left     = '-9999px';
      clone.style.top      = '0';
      document.body.appendChild(clone);

      const canvas = await html2canvas(clone, {
        scale: 2,
        backgroundColor: '#ffffff',
        logging: false,
      });
      document.body.removeChild(clone);

      const imgData = canvas.toDataURL('image/png');
      const pdf    = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pgW    = pdf.internal.pageSize.getWidth();
      const pgH    = pdf.internal.pageSize.getHeight();
      const iW     = pgW;
      const iH     = (canvas.height * pgW) / canvas.width;

      if (iH <= pgH) {
        pdf.addImage(imgData, 'PNG', 0, 0, iW, iH);
      } else {
        let yPos = 0;
        while (yPos < iH) {
          if (yPos > 0) pdf.addPage();
          pdf.addImage(imgData, 'PNG', 0, -yPos, iW, iH);
          yPos += pgH;
        }
      }

      pdf.save(`${today}_\u65e5\u8a08\u30ec\u30dd\u30fc\u30c8.pdf`);
      setCloseError(null);

      // \u4f1d\u7968\u4e00\u89a7PDF\uff082\u679a\u76ee\uff09
      await exportReceiptsPdf(todayReceipts, today);
    } catch (err) {
      console.error('PDF\u51fa\u529b\u5931\u6557:', err);
    } finally {
      setPdfGenerating(false);
    }
  };


  return (
    <div className="flex flex-col h-full bg-slate-100">
      {/* ── 2列コンテンツ ── */}
      <div className="flex-1 flex gap-0 overflow-hidden min-h-0 p-1.5 gap-1.5">

        {/* ══ 左列: 精算レポート ══ */}
        <div className="flex flex-col rounded-lg overflow-hidden shadow-sm bg-white" style={{ width: '72%' }}>
          <div className={`flex items-center justify-between px-3 py-2 flex-shrink-0 ${BLUE_HEADER}`}>
            <h2 className="text-[15px] font-bold">精算レポート</h2>
          </div>

          {isLoading ? (
            <div className="flex-1 flex items-center justify-center text-[14px] text-slate-400">
              読み込み中...
            </div>
          ) : (
            <div className="flex-1 flex overflow-hidden mx-2">
              <div className="flex-1 overflow-y-auto border-r border-slate-100 pr-2">
                <LRow label="件数"             value={`${kenCount}件`} />
                <LRow label="客数"             value={`${guestCount}名様`} />
                <LRow label="客単価"           value={`¥${avgPerGuest.toLocaleString()}`} />
                <LRow label="総売上点数"       value={`${totalItemCount}点`} />
                <LRow label="売上"             value={`¥${Math.floor(sales).toLocaleString()}`} />
                <LRow label="消費税"           value={`¥${Math.floor(tax).toLocaleString()}`} />
                {/* 売上・消費税 内訳トグル */}
                <div className="flex items-center justify-between px-2 py-1.5 border-b border-slate-100 min-h-[32px]">
                  <span className="text-[13px] text-slate-600">売上・消費税 内訳</span>
                  <button
                    onClick={() => setShowTaxDetail(v => !v)}
                    className="w-5 h-5 flex items-center justify-center rounded bg-slate-100 hover:bg-slate-200 text-slate-500 text-[13px] font-bold leading-none transition-colors"
                  >
                    {showTaxDetail ? '−' : '+'}
                  </button>
                </div>
                {showTaxDetail && (
                  <>
                    <LRow
                      label={`標準税率（${Math.round(taxRateNum * 100)}%）対象`}
                      value={`¥${Math.floor(taxableStandard).toLocaleString()}`}
                      sub={`消費税 ¥${stdTax.toLocaleString()}`}
                      dot
                    />
                    <LRow
                      label={`軽減税率（${Math.round(reducedRateNum * 100)}%）対象`}
                      value={`¥${Math.floor(taxableReduced).toLocaleString()}`}
                      sub={`消費税 ¥${redTax.toLocaleString()}`}
                      dot
                    />
                  </>
                )}
                <LRow label="純売上"           value={`¥${junSales.toLocaleString()}`} />
                <LRow label="サービス料金"     value={`¥${Math.floor(serviceCharge).toLocaleString()}`} sub={`${serviceCount}件`} />
                <LRow label="深夜料金"         value={`¥${Math.floor(lateNight).toLocaleString()}`} sub={`${lateNightCount}件`} />
                <LRow label="値割引"           value="" sub={`${discountCount}件`} />
                <LRow label="取消（赤伝票）"    value={`¥${Math.floor(cancelAmount).toLocaleString()}`}     sub={`${cancelCount}件`} />
                <LRow label="訂正（黒伝票）"    value={`¥${Math.floor(correctionAmount).toLocaleString()}`} sub={`${correctionCount}件`} />
              </div>
              <div className="flex-1 overflow-y-auto">
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
        <div className="flex flex-col rounded-lg overflow-hidden shadow-sm bg-white ml-1" style={{ width: '28%' }}>
          <div className={`flex items-center px-3 py-2 flex-shrink-0 ${BLUE_HEADER}`}>
            <span className="text-[14px] font-bold">レジクローズ時レジ実績入力</span>
          </div>

          <div className="flex items-center px-3 py-0.5 bg-slate-50 border-b border-slate-200 flex-shrink-0">
            <span className="flex-shrink-0 w-24" />
            <div className="flex-1" />
            <span className="flex-shrink-0 w-14" />
            <span className="flex-shrink-0 w-14 text-right text-[12px] font-bold text-slate-400 uppercase tracking-wider">差異</span>
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
              {closeError && (
                <div className="mb-2 px-3 py-2.5 bg-red-50 border border-red-200 rounded-lg text-[14px] text-red-700 leading-snug">
                  {closeError}
                </div>
              )}
              <button
                onClick={handleCloseAttempt}
                className={`w-full py-4 text-[15px] font-black rounded-lg ${BLUE_BTN}`}
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
          onClick={() => setShowPdfConfirm(true)}
          disabled={pdfGenerating}
          className={`inline-flex items-center justify-center gap-2 h-11 px-5 text-[14px] rounded-lg ${BLUE_BTN} disabled:opacity-60 disabled:cursor-not-allowed`}
        >
          {pdfGenerating ? (
            <>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-spin">
                <circle cx="12" cy="12" r="10" strokeOpacity="0.3" />
                <path d="M12 2a10 10 0 0 1 10 10" />
              </svg>
              生成中...
            </>
          ) : (
            <>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="12" y1="18" x2="12" y2="12"/>
                <line x1="9" y1="15" x2="15" y2="15"/>
              </svg>
              日計レポート + 伝票一覧　PDF出力
            </>
          )}
        </button>
      </div>

      {/* ── PDF出力用非表示コンテンツ（html2canvas キャプチャ対象） ── */}
      <div
        ref={reportPdfRef}
        aria-hidden="true"
        style={{
          position: 'absolute', left: '-9999px', top: 0,
          width: '750px', padding: '20px', background: '#fff',
          fontFamily: "'Hiragino Sans','Hiragino Kaku Gothic ProN','Noto Sans JP',sans-serif",
          fontSize: '11px', color: '#1e293b', boxSizing: 'border-box',
        }}
      >
        {/* ヘッダー */}
        <div style={{ borderBottom: '2px solid #2b70ef', paddingBottom: '10px', marginBottom: '16px' }}>
          <h1 style={{ fontSize: '18px', fontWeight: 900, color: '#2b70ef', margin: 0 }}>日計レポート</h1>
          <div style={{ display: 'flex', gap: '24px', marginTop: '6px', fontSize: '11px', color: '#64748b' }}>
            <span>営業日付: <strong>{today}</strong></span>
          </div>
        </div>

        {/* 精算レポート */}
        <div style={{ fontSize: '10px', fontWeight: 700, color: '#fff', background: '#2b70ef', padding: '4px 8px' }}>精算レポート</div>
        <div style={{ display: 'flex', border: '1px solid #e2e8f0', marginBottom: '16px' }}>
          {/* 左列 */}
          <div style={{ width: '50%', borderRight: '1px solid #e2e8f0' }}>
            <PRow label="件数"         value={`${kenCount}件`} />
            <PRow label="客数"         value={`${guestCount}名様`} />
            <PRow label="客単価"       value={`¥${avgPerGuest.toLocaleString()}`} />
            <PRow label="総売上点数"   value={`${totalItemCount}点`} />
            <PRow label="売上"         value={`¥${Math.floor(sales).toLocaleString()}`} />
            <PRow label="消費税"       value={`¥${Math.floor(tax).toLocaleString()}`} />
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start',
              padding:'4px 8px', borderBottom:'1px solid #f1f5f9', minHeight:'26px' }}>
              <span style={{ color:'#475569', fontSize:'11px' }}>売上・消費税 内訳</span>
              <div />
            </div>
            <PRow label={`標準税率（${Math.round(taxRateNum * 100)}%）対象`}
              value={`¥${Math.floor(taxableStandard).toLocaleString()}`}
              sub={`消費税 ¥${stdTax.toLocaleString()}`} indent dot />
            <PRow label={`軽減税率（${Math.round(reducedRateNum * 100)}%）対象`}
              value={`¥${Math.floor(taxableReduced).toLocaleString()}`}
              sub={`消費税 ¥${redTax.toLocaleString()}`} indent dot />
            <PRow label="純売上"       value={`¥${junSales.toLocaleString()}`} />
            <PRow label="サービス料金" value={`¥${Math.floor(serviceCharge).toLocaleString()}`} sub={`${serviceCount}件`} />
            <PRow label="深夜料金"     value={`¥${Math.floor(lateNight).toLocaleString()}`}     sub={`${lateNightCount}件`} />
            <PRow label="値割引"       sub={`${discountCount}件`} />
            <PRow label="取消（赤伝票）" value={`¥${Math.floor(cancelAmount).toLocaleString()}`}     sub={`${cancelCount}件`} />
            <PRow label="訂正（黒伝票）" value={`¥${Math.floor(correctionAmount).toLocaleString()}`} sub={`${correctionCount}件`} />
          </div>
          {/* 右列 */}
          <div style={{ width: '50%' }}>
            <PRow label="入金"           sub={`${m.deposit_count}件`} />
            <PRow label="出金"           value="¥0"                                              sub={`${m.withdraw_count}件`} />
            <PRow label="現金"           value={`¥${Math.floor(cashPay.revenue).toLocaleString()}`}   sub={`${cashPay.count}件`} />
            <PRow label="クレジット"     value={`¥${Math.floor(cardPay.revenue).toLocaleString()}`}   sub={`${cardPay.count}件`} />
            <PRow label="ポイント"       value={`¥${m.point_amount.toLocaleString()}`}                sub={`${m.point_count}件`} />
            <PRow label="電子マネー"     value={`¥${Math.floor(emoneyPay.revenue).toLocaleString()}`} sub={`${emoneyPay.count}件`} />
            <PRow label="商品券（釣無し）" value={`¥${Math.floor(giftNoChgAmount).toLocaleString()}`}  sub={`${giftNoChgCount}件`} />
            <PRow label="商品券（釣有り）" value={`¥${Math.floor(giftChgAmount).toLocaleString()}`}    sub={`${giftChgCount}件`} />
            <PRow label="掛売"           value={`¥${m.kakeuri_amount.toLocaleString()}`}              sub={`${m.kakeuri_count}件`} />
          </div>
        </div>

        {/* レジオープン時現金 */}
        <div style={{ fontSize: '10px', fontWeight: 700, color: '#fff', background: '#2b70ef', padding: '4px 8px' }}>レジオープン時現金</div>
        <div style={{ border: '1px solid #e2e8f0', marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px' }}>
            <span style={{ fontWeight: 700, color: '#475569' }}>開店時レジ現金</span>
            <span style={{ fontSize: '16px', fontWeight: 900, color: '#1e293b' }}>¥{registerOpenCash.toLocaleString()}</span>
          </div>
        </div>

        {/* フッター */}
        <div style={{ marginTop: '24px', paddingTop: '10px', borderTop: '1px solid #e2e8f0', fontSize: '10px', color: '#94a3b8', textAlign: 'right' }}>
          出力日時: {pdfTimestamp}
        </div>
      </div>

      {/* ── PDF出力確認ダイアログ ── */}
      {showPdfConfirm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
          <div className="bg-white rounded-xl shadow-xl overflow-hidden w-80">
            <div className="bg-primary-500 text-white px-4 py-3">
              <h3 className="text-[16px] font-bold">日計レポート出力</h3>
            </div>
            <div className="px-5 py-5">
              <p className="text-[15px] text-slate-700 text-center mb-6">
                日計レポートを出力しますか？
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowPdfConfirm(false)}
                  className="flex-1 py-4 text-[15px] font-bold border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  いいえ
                </button>
                <button
                  onClick={() => { setShowPdfConfirm(false); handlePdfExport(); }}
                  className="flex-1 py-4 text-[15px] font-bold rounded-lg bg-primary-500 hover:bg-primary-600 active:bg-primary-700 text-white transition-colors"
                >
                  はい
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
