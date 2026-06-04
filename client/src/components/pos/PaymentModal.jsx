import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';

const PAYMENT_METHODS = [
  { id: 'cash',   label: '現金' },
  { id: 'card',   label: 'カード' },
  { id: 'emoney', label: '電子マネー' },
];

// ── テンキー ──────────────────────────────────────────────
function Numpad({ value, onChange, onConfirm, exactAmount }) {
  const handleKey = (key) => {
    if (key === 'C')    { onChange(''); return; }
    if (key === '残額') { onChange(String(exactAmount)); return; }
    if (key === '決定') { onConfirm(); return; }
    const next = (value + key).replace(/^0+/, '') || '0';
    if (next.length > 8) return;
    onChange(next);
  };

  const digitBtn = (label) => (
    <button
      key={label}
      type="button"
      onClick={() => handleKey(label)}
      className="h-14 rounded-xl text-base font-bold bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 text-slate-900 shadow-sm transition-all active:scale-95"
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-3 gap-1.5">
        <button type="button" onClick={() => handleKey('C')}
          className="h-14 rounded-xl text-base font-bold bg-slate-100 hover:bg-slate-200 text-slate-600 transition-all active:scale-95">
          C
        </button>
        <button type="button" onClick={() => handleKey('残額')}
          className="col-span-2 h-14 rounded-xl text-base font-bold bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 transition-all active:scale-95">
          残額
        </button>
      </div>
      <div className="grid grid-cols-3 gap-1.5">{['7','8','9'].map(digitBtn)}</div>
      <div className="grid grid-cols-3 gap-1.5">{['4','5','6'].map(digitBtn)}</div>
      <div className="grid grid-cols-3 gap-1.5">{['1','2','3'].map(digitBtn)}</div>
      <div className="grid grid-cols-3 gap-1.5">
        {['0','00'].map(digitBtn)}
        <button type="button" onClick={() => handleKey('決定')}
          className="h-14 rounded-xl text-base font-bold bg-primary-600 hover:bg-primary-700 text-white transition-all active:scale-95 shadow-sm">
          決定
        </button>
      </div>
    </div>
  );
}

// ── 割引登録サブモーダル ──────────────────────────────────
export function DiscountModal({ subtotal, discountType, discountInput, onTypeChange, onInputChange, discountAmount, onApply, onClose }) {
  const tempNum = parseFloat(discountInput) || 0;
  const preview = discountType === 'amount'
    ? Math.min(tempNum, subtotal)
    : Math.round(subtotal * Math.min(tempNum, 100) / 100);

  return (
    <div className="absolute inset-0 bg-black/40 flex items-center justify-center z-10 rounded-xl">
      <div className="bg-white rounded-xl w-80 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="text-sm font-bold text-slate-900">割引登録</h3>
          <button onClick={onClose}
            className="w-10 h-10 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div className="p-5 space-y-4">
          {/* タイプ */}
          <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm font-semibold">
            <button
              onClick={() => { onTypeChange('amount'); onInputChange(''); }}
              className={`flex-1 py-4 transition-colors ${discountType === 'amount' ? 'bg-primary-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}
            >値引額</button>
            <button
              onClick={() => { onTypeChange('rate'); onInputChange(''); }}
              className={`flex-1 py-4 transition-colors ${discountType === 'rate' ? 'bg-primary-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}
            >割引率</button>
          </div>
          {/* 入力 */}
          <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden bg-slate-50 focus-within:ring-2 focus-within:ring-primary-400">
            <span className="pl-4 text-slate-400 text-sm">{discountType === 'amount' ? '¥' : ''}</span>
            <input
              type="number" min="0"
              max={discountType === 'rate' ? 100 : subtotal}
              value={discountInput}
              onChange={(e) => onInputChange(e.target.value)}
              placeholder="0"
              autoFocus
              className="flex-1 px-3 py-3 bg-transparent outline-none text-slate-900 text-right text-lg font-bold"
            />
            <span className="pr-4 text-slate-400 text-sm">{discountType === 'rate' ? '%' : ''}</span>
          </div>
          {/* プレビュー */}
          <div className="flex justify-between items-center px-1">
            <span className="text-sm text-slate-500">割引額プレビュー</span>
            <span className="text-xl font-black text-red-500">
              {preview > 0 ? `−¥${preview.toLocaleString()}` : '¥0'}
            </span>
          </div>
          {/* ボタン */}
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => { onTypeChange('amount'); onInputChange(''); }}
              className="flex-1 py-4 text-sm font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition-colors"
            >クリア</button>
            <button
              onClick={onApply}
              className="flex-1 py-4 text-sm font-bold bg-primary-600 hover:bg-primary-700 text-white rounded-xl transition-colors"
            >適用</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 金券サブモーダル ──────────────────────────────────────
function GiftCertModal({ finalTotal, giftCertTotal, onAddCert, onClear, giftCertNoChange, onToggleNoChange, onApply, onClose }) {
  const effectiveGiftCert = giftCertNoChange
    ? Math.min(giftCertTotal, finalTotal)
    : giftCertTotal;
  const remaining  = Math.max(finalTotal - effectiveGiftCert, 0);
  const giftChange = !giftCertNoChange ? Math.max(giftCertTotal - finalTotal, 0) : 0;

  return (
    <div className="absolute inset-0 bg-black/40 flex items-center justify-center z-10 rounded-xl">
      <div className="bg-white rounded-xl w-80 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="text-sm font-bold text-slate-900">金券</h3>
          <button onClick={onClose}
            className="w-10 h-10 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div className="p-5 space-y-4">
          {/* 金券追加 */}
          <div>
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-2.5">金券を追加</p>
            <div className="flex gap-2">
              <button
                onClick={() => onAddCert(500)}
                className="flex-1 py-5 text-base font-bold bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-xl transition-all active:scale-95"
              >+ ¥500券</button>
              <button
                onClick={() => onAddCert(1000)}
                className="flex-1 py-5 text-base font-bold bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-xl transition-all active:scale-95"
              >+ ¥1,000券</button>
            </div>
          </div>

          {/* 合計 */}
          <div className="bg-slate-50 rounded-xl px-4 py-3 flex justify-between items-center">
            <span className="text-sm text-slate-500">金券合計</span>
            <span className="text-2xl font-black text-slate-900">¥{giftCertTotal.toLocaleString()}</span>
          </div>

          {/* 釣り有り / 無し */}
          <div>
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-2.5">お釣り</p>
            <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm font-semibold">
              <button
                onClick={() => onToggleNoChange(false)}
                className={`flex-1 py-4 transition-colors ${!giftCertNoChange ? 'bg-primary-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}
              >釣り有り</button>
              <button
                onClick={() => onToggleNoChange(true)}
                className={`flex-1 py-4 transition-colors ${giftCertNoChange ? 'bg-primary-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}
              >釣り無し</button>
            </div>
          </div>

          {/* 計算結果 */}
          {giftCertTotal > 0 && (
            <div className="border border-slate-200 rounded-xl px-4 py-3 space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">金券後残額</span>
                <span className={`font-semibold ${remaining > 0 ? 'text-slate-900' : 'text-emerald-600'}`}>
                  ¥{remaining.toLocaleString()}
                </span>
              </div>
              {giftChange > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">金券おつり</span>
                  <span className="font-semibold text-emerald-600">¥{giftChange.toLocaleString()}</span>
                </div>
              )}
            </div>
          )}

          {/* ボタン */}
          <div className="flex gap-2 pt-1">
            <button
              onClick={onClear}
              className="flex-1 py-4 text-sm font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition-colors"
            >クリア</button>
            <button
              onClick={onApply}
              className="flex-1 py-4 text-sm font-bold bg-primary-600 hover:bg-primary-700 text-white rounded-xl transition-colors"
            >適用</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 会計結果モーダル ──────────────────────────────────────
export function PaymentResultModal({ result, onClose }) {
  const methodLabel = { cash: '現金', card: 'カード', emoney: '電子マネー' };
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
        <div className="bg-emerald-500 px-6 py-5 text-center">
          <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-2">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
              <path d="M20 6L9 17l-5-5"/>
            </svg>
          </div>
          <p className="text-white font-bold text-lg">会計完了</p>
          <p className="text-emerald-100 text-sm mt-0.5">{result.tableName}</p>
        </div>

        <div className="px-6 py-4 space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">滞在時間</span>
            <span className="font-semibold text-slate-900">{result.elapsedTime}</span>
          </div>

          <div className="border-t border-slate-100" />

          <div className="space-y-1.5">
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">商品合計</span>
              <span className="text-slate-900">¥{result.itemsSubtotal.toLocaleString()}</span>
            </div>
            {result.chargeAmount > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">チャージ</span>
                <span className="text-slate-900">¥{result.chargeAmount.toLocaleString()}</span>
              </div>
            )}
            {result.lateNightAmount > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-amber-600">深夜料金</span>
                <span className="text-amber-600">+¥{result.lateNightAmount.toLocaleString()}</span>
              </div>
            )}
            {result.discountAmount > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-red-500">割引</span>
                <span className="text-red-500">−¥{result.discountAmount.toLocaleString()}</span>
              </div>
            )}
            {result.giftCertAmount > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-emerald-600">金券</span>
                <span className="text-emerald-600">−¥{result.giftCertAmount.toLocaleString()}</span>
              </div>
            )}
          </div>

          <div className="border-t border-slate-100" />

          <div className="flex justify-between items-center">
            <span className="text-sm font-semibold text-slate-700">お支払い金額</span>
            <span className="text-2xl font-black text-slate-900">¥{result.finalTotal.toLocaleString()}</span>
          </div>

          <div className="flex justify-between text-sm">
            <span className="text-slate-500">支払方法</span>
            <span className="font-semibold text-slate-900">{methodLabel[result.paymentMethod] ?? result.paymentMethod}</span>
          </div>

          {result.paymentMethod === 'cash' && (
            <>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">お預かり金額</span>
                <span className="font-semibold text-slate-900">¥{result.received.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">お釣り</span>
                <span className="font-bold text-slate-900">¥{result.change.toLocaleString()}</span>
              </div>
            </>
          )}
        </div>

        <div className="px-6 pb-5">
          <button
            onClick={onClose}
            className="w-full py-3 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl transition-colors"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}

// ── メインコンポーネント ─────────────────────────────────────
export default function PaymentModal({ order, table, onClose, onPaid }) {
  const queryClient = useQueryClient();

  // 支払い
  const [paymentMethod,    setPaymentMethod]    = useState('cash');
  const [showOtherPayment, setShowOtherPayment] = useState(false);
  const [receivedInput,    setReceivedInput]    = useState('');
  // メモ
  const [memo, setMemo] = useState('');
  // 割引 (modal用 temp state)
  const [discountType,  setDiscountType]  = useState('amount');
  const [discountInput, setDiscountInput] = useState('');
  const [showDiscountModal, setShowDiscountModal] = useState(false);
  const [savedDiscountType,  setSavedDiscountType]  = useState('amount');
  const [savedDiscountInput, setSavedDiscountInput] = useState('');
  // 金券 (modal用 temp state)
  const [giftCertTotal,    setGiftCertTotal]    = useState(0);
  const [giftCertNoChange, setGiftCertNoChange] = useState(false);
  const [showGiftCertModal,    setShowGiftCertModal]    = useState(false);
  const [tempGiftCertTotal,    setTempGiftCertTotal]    = useState(0);
  const [tempGiftCertNoChange, setTempGiftCertNoChange] = useState(false);
  // 会計結果
  const [payResult, setPayResult] = useState(null);

  // システム設定
  const { data: sysSettings } = useQuery({
    queryKey: ['system-settings'],
    queryFn: api.getSystemSettings,
    staleTime: 60_000,
  });
  const taxRate = sysSettings?.tax_rate        ?? 0.10;
  const lnRate  = sysSettings?.late_night_rate  ?? 0.10;
  const lnStart = sysSettings?.late_night_start ?? 22;
  const lnEnd   = sysSettings?.late_night_end   ?? 29;

  const isLateNight = (() => {
    const h = new Date().getHours();
    if (lnStart < 24 && lnEnd > 24) return h >= lnStart || h < (lnEnd - 24);
    if (lnStart >= 24) return h >= (lnStart - 24) && h < (lnEnd - 24);
    return h >= lnStart && h < lnEnd;
  })();

  // ── 金額計算（全て税込み価格） ──
  const itemsSubtotal   = order.items.reduce((s, i) => s + i.quantity * i.unit_price, 0);
  const chargeAmount    = parseFloat(order.charge_amount) || 0;
  const subtotal        = itemsSubtotal + chargeAmount;
  // 深夜料金はアイテム小計のみに適用
  const lateNightAmount = isLateNight ? Math.round(itemsSubtotal * lnRate) : 0;
  const discountNum     = parseFloat(savedDiscountInput) || 0;
  const discountAmount  = savedDiscountType === 'amount'
    ? Math.min(discountNum, subtotal)
    : Math.round(subtotal * Math.min(discountNum, 100) / 100);
  const taxableBase = subtotal + lateNightAmount - discountAmount;
  // 内税計算（表示用のみ、合計には加算しない）
  const taxAmount   = Math.round(taxableBase * taxRate / (1 + taxRate));
  const finalTotal  = taxableBase;

  // 金券
  const effectiveGiftCert  = giftCertNoChange
    ? Math.min(giftCertTotal, finalTotal)
    : giftCertTotal;
  const remainingAfterGift = Math.max(finalTotal - effectiveGiftCert, 0);

  // 現金
  const isCash    = paymentMethod === 'cash';
  const received  = parseInt(receivedInput, 10) || 0;
  const totalPaid = received + effectiveGiftCert;
  const balance   = Math.max(finalTotal - totalPaid, 0);
  const change    = Math.max(totalPaid - finalTotal, 0);

  // 経過時間
  const elapsedTime = (() => {
    if (!order.opened_at) return '--:--';
    const diff = Date.now() - new Date(order.opened_at).getTime();
    const h = Math.floor(diff / 3_600_000);
    const m = Math.floor((diff % 3_600_000) / 60_000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  })();

  const payMutation = useMutation({
    mutationFn: () => api.pay(
      order.id,
      paymentMethod,
      discountAmount,
      memo || null,
      effectiveGiftCert,
      giftCertNoChange,
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tables'] });
      setPayResult({
        tableName:       table.name,
        elapsedTime,
        itemsSubtotal,
        chargeAmount,
        lateNightAmount,
        discountAmount,
        giftCertAmount:  effectiveGiftCert,
        finalTotal,
        paymentMethod,
        received,
        change,
      });
    },
  });

  const canPay = !payMutation.isPending && (isCash ? totalPaid >= finalTotal : true);

  const handleConfirm = () => {
    if (canPay) payMutation.mutate();
  };

  // ── 割引モーダル操作 ──
  const openDiscountModal = () => {
    setDiscountType(savedDiscountType);
    setDiscountInput(savedDiscountInput);
    setShowDiscountModal(true);
  };
  const applyDiscount = () => {
    setSavedDiscountType(discountType);
    setSavedDiscountInput(discountInput);
    setShowDiscountModal(false);
  };
  const closeDiscountModal = () => {
    // 変更を破棄して閉じる
    setDiscountType(savedDiscountType);
    setDiscountInput(savedDiscountInput);
    setShowDiscountModal(false);
  };

  // ── 金券モーダル操作 ──
  const openGiftCertModal = () => {
    setTempGiftCertTotal(giftCertTotal);
    setTempGiftCertNoChange(giftCertNoChange);
    setShowGiftCertModal(true);
  };
  const applyGiftCert = () => {
    setGiftCertTotal(tempGiftCertTotal);
    setGiftCertNoChange(tempGiftCertNoChange);
    setShowGiftCertModal(false);
  };
  const closeGiftCertModal = () => {
    setShowGiftCertModal(false);
  };

  return (
    <>
    {payResult && <PaymentResultModal result={payResult} onClose={onPaid} />}
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-3">
      <div className="relative bg-slate-100 rounded-xl w-full max-w-5xl shadow-2xl border border-slate-200 flex flex-col h-[88vh] overflow-hidden">

        {/* ── サブモーダル ── */}
        {showDiscountModal && (
          <DiscountModal
            subtotal={subtotal}
            discountType={discountType}
            discountInput={discountInput}
            onTypeChange={setDiscountType}
            onInputChange={setDiscountInput}
            discountAmount={discountAmount}
            onApply={applyDiscount}
            onClose={closeDiscountModal}
          />
        )}
        {showGiftCertModal && (
          <GiftCertModal
            finalTotal={finalTotal}
            giftCertTotal={tempGiftCertTotal}
            onAddCert={(amt) => setTempGiftCertTotal((p) => p + amt)}
            onClear={() => setTempGiftCertTotal(0)}
            giftCertNoChange={tempGiftCertNoChange}
            onToggleNoChange={setTempGiftCertNoChange}
            onApply={applyGiftCert}
            onClose={closeGiftCertModal}
          />
        )}

        {/* ── トップバー ── */}
        <div className="bg-white px-4 py-2.5 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <span className="font-semibold text-slate-700">{table.name}</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 18l6-6-6-6"/>
            </svg>
            <span>レジ会計</span>
          </div>
          <button
            onClick={onClose}
            className="w-10 h-10 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* ── 3カラムレイアウト ── */}
        <div className="flex flex-1 min-h-0">

          {/* ─── 左パネル: 注文明細 ─── */}
          <div className="w-52 bg-white border-r border-slate-200 flex flex-col flex-shrink-0">
            {/* テーブル情報 */}
            <div className="px-3 py-2.5 border-b border-slate-100 bg-slate-50 flex-shrink-0">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-slate-900">{table.name}</span>
              </div>
              <div className="flex items-center mt-1">
                <span className="text-[11px] text-slate-400">
                  時間 <span className="text-slate-600 font-medium">{elapsedTime}</span>
                </span>
              </div>
            </div>

            {/* 商品リスト */}
            <div className="flex-1 overflow-y-auto">
              {order.items.map((item) => (
                <div key={item.id} className="flex items-center justify-between px-3 py-2.5 border-b border-slate-50 text-xs">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-800 truncate leading-tight">{item.item_name}</p>
                    <p className="text-slate-400 mt-0.5">×{item.quantity}</p>
                  </div>
                  <span className="text-slate-700 font-semibold ml-2 flex-shrink-0">
                    ¥{(item.quantity * item.unit_price).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>

            {/* フッターボタン */}
            <div className="border-t border-slate-100 p-2 flex-shrink-0">
              {/* 注文: モーダルを閉じて注文画面に戻る */}
              <button
                onClick={onClose}
                className="w-full py-3 text-sm font-medium bg-white border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 transition-colors"
              >
                注文
              </button>
            </div>
          </div>

          {/* ─── 中央パネル: レジ会計 ─── */}
          <div className="flex-1 flex flex-col bg-slate-50 border-r border-slate-200">
            {/* 中央ヘッダー */}
            <div className="flex items-center justify-center px-3 py-2 bg-white border-b border-slate-100 flex-shrink-0">
              <span className="text-xs font-bold text-slate-700">レジ会計</span>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">

              {/* 小計内訳 */}
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-4 py-2 bg-slate-50 border-b border-slate-100">
                  <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">内訳</span>
                </div>
                <div className="divide-y divide-slate-50">
                  <div className="flex justify-between items-center px-4 py-2.5 text-sm">
                    <span className="text-slate-600 flex items-center gap-1.5">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-emerald-500 flex-shrink-0">
                        <path d="M20 6L9 17l-5-5"/>
                      </svg>
                      商品合計（税込み）
                    </span>
                    <span className="font-semibold text-slate-900">¥{itemsSubtotal.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between items-center px-4 py-2.5 text-sm">
                    <span className="text-slate-600">
                      チャージ（{order.guest_count ?? 1}名 × ¥{(order.charge_per_person ?? 0).toLocaleString()}）
                    </span>
                    <span className="font-semibold text-slate-900">¥{chargeAmount.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between items-center px-4 py-2.5 text-sm">
                    <span className={isLateNight ? 'text-amber-600' : 'text-slate-400'}>
                      深夜料金（{Math.round(lnRate * 100)}%）
                    </span>
                    <span className={`font-semibold ${isLateNight ? 'text-amber-600' : 'text-slate-400'}`}>
                      {isLateNight ? `+¥${lateNightAmount.toLocaleString()}` : '¥0'}
                    </span>
                  </div>
                  {discountAmount > 0 && (
                    <div className="flex justify-between items-center px-4 py-2.5 text-sm">
                      <span className="text-red-500">値引合計</span>
                      <span className="font-semibold text-red-500">
                        −¥{discountAmount.toLocaleString()}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* お支払い金額 */}
              <div className="bg-white rounded-xl border border-slate-200 px-4 py-3">
                <div className="flex justify-between items-center">
                  <div>
                    <p className="text-xs font-semibold text-slate-500">お支払い総額（税込み）</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      内税（{Math.round(taxRate * 100)}%）: ¥{taxAmount.toLocaleString()}
                    </p>
                  </div>
                  <span className="text-2xl font-black text-slate-900">¥{finalTotal.toLocaleString()}</span>
                </div>
              </div>

              {/* メモ */}
              <div className="bg-white rounded-xl border border-slate-200 px-4 py-3">
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1.5">メモ</p>
                <textarea
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  placeholder="メモを入力..."
                  rows={2}
                  className="w-full text-xs text-slate-700 bg-transparent outline-none resize-none placeholder-slate-300 leading-relaxed"
                />
              </div>


            </div>

          </div>

          {/* ─── 右パネル: 支払い方法 ─── */}
          <div className="w-80 bg-white flex flex-col flex-shrink-0">

            {/* 割引登録 / 金券 */}
            <div className="px-3 pt-3 pb-2 flex gap-2 border-b border-slate-100 flex-shrink-0">
              {/* 割引登録 */}
              <button
                onClick={openDiscountModal}
                className={`flex-1 py-4 text-sm font-semibold rounded-lg border transition-colors relative ${
                  discountAmount > 0
                    ? 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                割引登録
                {discountAmount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-none">
                    適用中
                  </span>
                )}
              </button>
              {/* 金券 */}
              <button
                onClick={openGiftCertModal}
                className={`flex-1 py-4 text-sm font-semibold rounded-lg border transition-colors relative ${
                  effectiveGiftCert > 0
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                金券
                {effectiveGiftCert > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 bg-emerald-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-none">
                    適用中
                  </span>
                )}
              </button>
            </div>

            <div className="flex-1 flex flex-col p-3 gap-2.5 overflow-hidden">

              {/* 現金ボタン */}
              <button
                onClick={() => { setPaymentMethod('cash'); setShowOtherPayment(false); setReceivedInput(''); }}
                className={`w-full py-5 rounded-xl text-xl font-bold transition-all ${
                  paymentMethod === 'cash'
                    ? 'bg-primary-600 text-white shadow-md'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                現金
              </button>

              {/* その他支払ボタン */}
              <button
                onClick={() => {
                  const next = !showOtherPayment;
                  setShowOtherPayment(next);
                  setReceivedInput('');
                  if (next && paymentMethod === 'cash') setPaymentMethod('card');
                  if (!next) setPaymentMethod('cash');
                }}
                className={`w-full py-4 rounded-xl text-sm font-medium transition-all border ${
                  paymentMethod !== 'cash'
                    ? 'border-primary-500 bg-primary-50 text-primary-700'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                その他支払
              </button>

              {/* カード / 電子マネー サブ選択 */}
              {showOtherPayment && (
                <div className="flex gap-2">
                  {PAYMENT_METHODS.filter((m) => m.id !== 'cash').map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setPaymentMethod(m.id)}
                      className={`flex-1 py-3.5 rounded-xl text-sm font-semibold border transition-all ${
                        paymentMethod === m.id
                          ? 'border-primary-500 bg-primary-50 text-primary-700'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              )}

              {/* 受取金額ディスプレイ + 残高・おつり */}
              <div className="bg-white border border-slate-200 rounded-xl flex-shrink-0 overflow-hidden">
                <div className="px-4 py-3 text-right">
                  <p className="text-[10px] text-slate-400 mb-0.5">
                    {isCash ? 'お預かり（現金）' : PAYMENT_METHODS.find(m => m.id === paymentMethod)?.label ?? 'その他'}
                  </p>
                  <p className="text-xl font-black text-slate-900 tracking-wider">
                    ¥{receivedInput ? parseInt(receivedInput, 10).toLocaleString() : '0'}
                  </p>
                  {isCash && remainingAfterGift > 0 && effectiveGiftCert > 0 && (
                    <p className="text-xs text-slate-400 mt-0.5">
                      金券後残額 ¥{remainingAfterGift.toLocaleString()}
                    </p>
                  )}
                </div>
                <div className="border-t border-slate-100 px-4 py-2.5 space-y-1.5">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">残高</span>
                    <span className={`font-semibold ${balance > 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                      ¥{balance.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">おつり</span>
                    <span className="font-bold text-slate-900">¥{change.toLocaleString()}</span>
                  </div>
                </div>
              </div>

              {/* テンキー */}
              <div className="flex-1 flex flex-col justify-end">
                <Numpad
                  value={receivedInput}
                  onChange={setReceivedInput}
                  onConfirm={handleConfirm}
                  exactAmount={remainingAfterGift}
                />
              </div>

            </div>

            {/* 会計ボタン */}
            <div className="p-3 border-t border-slate-200 flex-shrink-0">
              <button
                onClick={handleConfirm}
                disabled={!canPay || payMutation.isPending}
                className="w-full py-5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white rounded-xl font-black transition-colors text-base shadow-sm"
              >
                {payMutation.isPending ? '処理中...' : '会計'}
              </button>
            </div>
          </div>


        </div>
      </div>
    </div>
    </>
  );
}
