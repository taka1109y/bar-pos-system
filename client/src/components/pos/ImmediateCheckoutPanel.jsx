import { useState, useEffect, useRef } from 'react';
import { yen } from '../../utils/format';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import { newIdempotencyKey } from '../../utils/uuid';
import { useToastStore } from '../../store/useToastStore';
import socket from '../../socket';
import MenuGrid from './MenuGrid';
import { DiscountModal, GiftCertModal, PaymentResultModal } from './PaymentModal';
import CustomPriceModal from './CustomPriceModal';
import ChoiceModal from './ChoiceModal';

// ── テンキー ─────────────────────────────────────────────────
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
      className="h-14 rounded-xl text-base font-bold bg-surface border border-line hover:bg-surface-sunken text-heading shadow-sm transition-all active:scale-95"
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-3 gap-2.5">
        <button type="button" onClick={() => handleKey('C')}
          className="h-14 rounded-xl text-base font-bold bg-surface-sunken hover:bg-surface-hover text-body transition-all active:scale-95">
          C
        </button>
        <button type="button" onClick={() => handleKey('残額')}
          className="col-span-2 h-14 rounded-xl text-base font-bold bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 transition-all active:scale-95">
          残額
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2.5">{['7','8','9'].map(digitBtn)}</div>
      <div className="grid grid-cols-3 gap-2.5">{['4','5','6'].map(digitBtn)}</div>
      <div className="grid grid-cols-3 gap-2.5">{['1','2','3'].map(digitBtn)}</div>
      <div className="grid grid-cols-3 gap-2.5">
        {['0','00'].map(digitBtn)}
        <button type="button" onClick={() => handleKey('決定')}
          className="h-14 rounded-xl text-base font-bold bg-primary-600 hover:bg-primary-700 text-white transition-all active:scale-95 shadow-sm">
          決定
        </button>
      </div>
    </div>
  );
}

// ── メインコンポーネント ──────────────────────────────────────
export default function ImmediateCheckoutPanel({ menuItems, categories, subcategories = [] }) {
  const queryClient = useQueryClient();

  const [paymentMethod,      setPaymentMethod]      = useState('cash');
  const [receivedInput,      setReceivedInput]      = useState('');
  const [showOtherPayment,   setShowOtherPayment]   = useState(false);
  // 分割会計（複数支払い方法）
  const [splitMode,          setSplitMode]          = useState(false);
  const [splitAmounts,       setSplitAmounts]       = useState({ cash: 0, card: 0, emoney: 0 });
  const [splitActive,        setSplitActive]        = useState('cash');
  const [splitInput,         setSplitInput]         = useState('');
  const [discountType,       setDiscountType]       = useState('amount');
  const [discountInput,      setDiscountInput]      = useState('');
  const [savedDiscountType,  setSavedDiscountType]  = useState('amount');
  const [savedDiscountInput, setSavedDiscountInput] = useState('');
  const [showDiscountModal,  setShowDiscountModal]  = useState(false);
  const [giftCertTotal,         setGiftCertTotal]         = useState(0);
  const [giftCertNoChange,      setGiftCertNoChange]      = useState(false);
  const [showGiftCertModal,     setShowGiftCertModal]     = useState(false);
  const [tempGiftCertTotal,     setTempGiftCertTotal]     = useState(0);
  const [tempGiftCertNoChange,  setTempGiftCertNoChange]  = useState(false);
  const [payResult,          setPayResult]          = useState(null);
  const [priceEditItem,      setPriceEditItem]      = useState(null);
  const [choiceItem,         setChoiceItem]         = useState(null);

  // 暴落中カードの残り時間表示用(crash_ends_at)
  const { data: sysSettings } = useQuery({ queryKey: ['system-settings'], queryFn: api.getSystemSettings, staleTime: 60_000 });

  // record-only: サーバに open 注文を作らず、商品は会計時までクライアントのカート(staged)に保持する。
  // 会計を押すまでサーバには何も残らない=離脱しても未会計は発生しない。
  const [staged, setStaged] = useState([]); // [{ key, menu_item_id, item_name, unit_price, quantity, is_drink, selected_option }]
  const lineKeyRef = useRef(0);

  // カートへ追加。merge=true(通常商品)は同一行(商品/単価/名称/選択肢が一致)へ数量加算。
  // 時価・選択肢商品は1点ごとに価格/内容が異なり得るため merge=false で常に新規行。
  const addStaged = (line, merge) => {
    setStaged((prev) => {
      if (merge) {
        const idx = prev.findIndex((l) =>
          l.menu_item_id === line.menu_item_id &&
          l.unit_price === line.unit_price &&
          l.item_name === line.item_name &&
          (l.selected_option ?? null) === (line.selected_option ?? null));
        if (idx >= 0) {
          const next = prev.slice();
          next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
          return next;
        }
      }
      return [...prev, { key: ++lineKeyRef.current, quantity: 1, selected_option: null, ...line }];
    });
  };
  const setLineQty = (key, qty) => setStaged((prev) =>
    qty <= 0 ? prev.filter((l) => l.key !== key) : prev.map((l) => (l.key === key ? { ...l, quantity: qty } : l)));
  const clearStaged = () => setStaged([]);

  const idemKeyRef = useRef(null);
  const [payError, setPayError] = useState('');
  const payMutation = useMutation({
    mutationFn: () => api.immediateCheckout({
      items: staged.map((l) => ({
        menu_item_id:   l.menu_item_id,
        quantity:       l.quantity,
        unit_price:     l.unit_price,
        item_name:      l.item_name,
        selected_option: l.selected_option ?? null,
      })),
      ...(splitMode
        ? { payments: splitPayments, discountAmount }
        : { paymentMethod, discountAmount, giftCertAmount: effectiveGiftCert, giftCertNoChange }),
      idempotencyKey: idemKeyRef.current,
    }),
    onError: (e) => setPayError(e?.message || '会計に失敗しました。通信状態を確認してください。'),
    onSuccess: () => {
      setPayError('');
      setPayResult({
        tableName:       '即会計',
        elapsedTime:     '--:--',
        itemsSubtotal,
        chargeAmount:    0,
        lateNightAmount: 0,
        discountAmount,
        giftCertAmount:  splitMode ? 0 : effectiveGiftCert,
        finalTotal,
        paymentMethod:   splitMode ? 'split' : paymentMethod,
        payments:        splitMode ? { ...splitAlloc } : null,
        received:        splitMode ? splitAmounts.cash : received,
        change:          splitMode ? splitChange : change,
      });
    },
  });

  // メニュータップ → 時価商品は価格入力モーダル、質問商品は選択、その他はカートへ加算
  const handleAddItem = (menuItem) => {
    if (menuItem.price_editable) {
      setPriceEditItem({
        menu_item_id: menuItem.id,
        defaultName:  menuItem.name,
        defaultPrice: Math.round(menuItem.current_price ?? menuItem.base_price ?? 0),
      });
      return;
    }
    if (menuItem.question_text) {
      setChoiceItem({
        menu_item_id:  menuItem.id,
        title:         menuItem.question_text,
        choices:       menuItem.question_choices || [],
        allowMultiple: !!menuItem.question_allow_multiple,
        allowQuantity: !!menuItem.question_allow_quantity,
      });
      return;
    }
    addStaged({
      menu_item_id: menuItem.id,
      item_name:    menuItem.name,
      unit_price:   Math.round(menuItem.current_price ?? menuItem.base_price ?? 0),
      is_drink:     !!menuItem.is_drink,
    }, true);
  };

  // 質問商品の選択確定 → 単価(priceDelta加算)と選択肢文字列を確定してカートへ
  const handleChoiceConfirm = (chosen) => {
    const mi = menuItems.find((m) => m.id === choiceItem.menu_item_id);
    const choices = mi?.question_choices || [];
    const deltaOf = (label) => Number((choices.find((c) => c.label === label)?.priceDelta) || 0);
    let price = Math.round(mi?.current_price ?? mi?.base_price ?? 0);
    let labelStr = '';
    if (choiceItem.allowQuantity) {
      price += chosen.reduce((s, c) => s + deltaOf(c.label) * (parseInt(c.count, 10) || 0), 0);
      labelStr = chosen.map((c) => `${c.label}×${c.count}`).join(', ');
    } else if (choiceItem.allowMultiple) {
      const labels = [...new Set(chosen.map((c) => c.label))];
      price += labels.reduce((s, l) => s + deltaOf(l), 0);
      labelStr = labels.join(', ');
    } else {
      price += deltaOf(chosen[0].label);
      labelStr = chosen[0].label;
    }
    addStaged({
      menu_item_id:   choiceItem.menu_item_id,
      item_name:      mi?.name ?? '商品',
      unit_price:     price,
      is_drink:       !!mi?.is_drink,
      selected_option: labelStr,
    }, false);
    setChoiceItem(null);
  };

  // 時価商品の価格・商品名を確定してカートへ
  const handlePriceConfirm = (name, price) => {
    const mi = menuItems.find((m) => m.id === priceEditItem.menu_item_id);
    addStaged({
      menu_item_id: priceEditItem.menu_item_id,
      item_name:    name,
      unit_price:   Math.round(price),
      is_drink:     !!mi?.is_drink,
    }, false);
    setPriceEditItem(null);
  };

  const handleQtyIncrease = (line) => {
    const mi = menuItems.find((m) => m.id === line.menu_item_id);
    if (mi?.price_editable) {
      // 時価商品は1点ごとに価格が異なり得るため、追加のたびに価格を入力させる（新規行）
      setPriceEditItem({
        menu_item_id: line.menu_item_id,
        defaultName:  line.item_name,
        defaultPrice: Math.round(line.unit_price),
      });
      return;
    }
    if (mi?.question_text) {
      setChoiceItem({
        menu_item_id:  mi.id,
        title:         mi.question_text,
        choices:       mi.question_choices || [],
        allowMultiple: !!mi.question_allow_multiple,
        allowQuantity: !!mi.question_allow_quantity,
      });
      return;
    }
    setLineQty(line.key, line.quantity + 1);
  };

  const handleQtyDecrease = (line) => setLineQty(line.key, line.quantity - 1);

  const handlePayResultClose = () => {
    setPayResult(null);
    clearStaged();
    setReceivedInput('');
    setPaymentMethod('cash');
    setShowOtherPayment(false);
    setSavedDiscountType('amount');
    setSavedDiscountInput('');
    setDiscountType('amount');
    setDiscountInput('');
    setGiftCertTotal(0);
    setGiftCertNoChange(false);
    setTempGiftCertTotal(0);
    setTempGiftCertNoChange(false);
    // 分割リセット
    setSplitMode(false);
    setSplitAmounts({ cash: 0, card: 0, emoney: 0 });
    setSplitActive('cash');
  };

  // ── 金額計算 ──
  const itemsSubtotal  = staged.reduce((s, i) => s + i.quantity * i.unit_price, 0);
  const discountNum    = Math.max(0, parseFloat(savedDiscountInput) || 0); // 負値禁止
  const discountAmount = savedDiscountType === 'amount'
    ? Math.min(discountNum, itemsSubtotal)
    : Math.round(itemsSubtotal * Math.min(discountNum, 100) / 100);
  const finalTotal = Math.max(itemsSubtotal - discountAmount, 0);

  const effectiveGiftCert  = giftCertNoChange
    ? Math.min(giftCertTotal, finalTotal)
    : giftCertTotal;
  const remainingAfterGift = Math.max(finalTotal - effectiveGiftCert, 0);

  const isCash    = paymentMethod === 'cash';
  const received  = parseInt(receivedInput, 10) || 0;
  const totalPaid = received + effectiveGiftCert;
  const balance   = Math.max(finalTotal - totalPaid, 0);
  const change    = Math.max(totalPaid - finalTotal, 0);

  // 分割会計（確定済み splitAmounts を集計。splitInput は入力中バッファ）
  const SPLIT_METHODS  = [{ id: 'cash', label: '現金' }, { id: 'card', label: 'カード' }, { id: 'emoney', label: '電子マネー' }];
  const cashlessSum    = splitAmounts.card + splitAmounts.emoney;   // カード＋電子マネー（超過不可）
  const enteredSum     = splitAmounts.cash + cashlessSum;           // 入力済み合計（お預かり相当）
  const splitRemaining = Math.max(finalTotal - enteredSum, 0);      // 差額
  const splitChange    = Math.max(enteredSum - finalTotal, 0);      // おつり（現金の超過分）
  const splitFillValue = Math.max(finalTotal - (enteredSum - splitAmounts[splitActive]), 0);
  const cashAlloc      = Math.max(finalTotal - cashlessSum, 0);     // 会計時の現金配分
  const splitAlloc     = { cash: cashAlloc, card: splitAmounts.card, emoney: splitAmounts.emoney };
  const splitPayments  = SPLIT_METHODS.filter((m) => splitAlloc[m.id] > 0).map((m) => ({ method: m.id, amount: splitAlloc[m.id] }));

  const switchSplitMode = (on) => {
    setSplitMode(on);
    setReceivedInput('');
    if (on) {
      setSplitAmounts({ cash: 0, card: 0, emoney: 0 });
      setSplitActive('cash');
      setSplitInput('');
      setGiftCertTotal(0);
      setGiftCertNoChange(false);
    }
  };
  const selectSplitMethod = (m) => {
    setSplitActive(m);
    setSplitInput('');
  };
  const onSplitInput = (v) => setSplitInput(v);
  const commitSplit = () => {
    if (splitInput === '') return;
    setSplitAmounts((p) => ({ ...p, [splitActive]: parseInt(splitInput, 10) || 0 }));
    setSplitInput('');
  };
  const clearSplit = () => {
    setSplitAmounts({ cash: 0, card: 0, emoney: 0 });
    setSplitInput('');
  };

  const canPay = staged.length > 0 && !payMutation.isPending
    && (splitMode ? (finalTotal > 0 && enteredSum >= finalTotal && cashlessSum <= finalTotal) : (isCash ? totalPaid >= finalTotal : true));

  const items = staged;

  return (
    <>
      {payResult && <PaymentResultModal result={payResult} onClose={handlePayResultClose} />}

      <div className="flex flex-1 overflow-hidden">

        {/* ─── 左パネル: メニュー選択 ─── */}
        <div className="flex-1 overflow-y-auto p-4">
          <MenuGrid
            menuItems={menuItems}
            categories={categories}
            subcategories={subcategories}
            onAddItem={handleAddItem}
            crashEndsAt={sysSettings?.crash_ends_at}
          />
        </div>

        {/* ─── 右パネル: 会計 ─── */}
        <div className="w-80 border-l border-line bg-surface flex flex-col flex-shrink-0 relative">

          {/* 割引モーダル（右パネル内に絶対配置） */}
          {showDiscountModal && (
            <DiscountModal
              subtotal={itemsSubtotal}
              discountType={discountType}
              discountInput={discountInput}
              onTypeChange={setDiscountType}
              onInputChange={setDiscountInput}
              discountAmount={discountAmount}
              onApply={() => {
                setSavedDiscountType(discountType);
                setSavedDiscountInput(discountInput);
                setShowDiscountModal(false);
              }}
              onClose={() => {
                setDiscountType(savedDiscountType);
                setDiscountInput(savedDiscountInput);
                setShowDiscountModal(false);
              }}
            />
          )}
          {/* 金券モーダル（右パネル内に絶対配置） */}
          {showGiftCertModal && (
            <GiftCertModal
              finalTotal={finalTotal}
              giftCertTotal={tempGiftCertTotal}
              onAddCert={(amt) => setTempGiftCertTotal((p) => p + amt)}
              onClear={() => setTempGiftCertTotal(0)}
              giftCertNoChange={tempGiftCertNoChange}
              onToggleNoChange={setTempGiftCertNoChange}
              onApply={() => {
                setGiftCertTotal(tempGiftCertTotal);
                setGiftCertNoChange(tempGiftCertNoChange);
                setShowGiftCertModal(false);
              }}
              onClose={() => setShowGiftCertModal(false)}
            />
          )}

          {/* ヘッダー */}
          <div className="px-4 py-3 border-b border-line bg-surface-sunken flex-shrink-0">
            <p className="text-sm font-bold text-heading">即会計</p>
            <p className="text-[11px] text-faint">チャージなし・即時会計</p>
          </div>

          {/* 商品リスト */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {items.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <p className="text-xs text-faint text-center px-6">
                  左のメニューから商品を追加してください
                </p>
              </div>
            ) : (
              <div className="divide-y divide-line">
                {items.map((item) => (
                  <div key={item.key} className="flex items-center gap-2 px-3 py-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-body truncate">
                        {item.item_name}
                        {item.selected_option && <span className="text-faint">（{item.selected_option}）</span>}
                      </p>
                      <p className="text-[11px] text-faint mt-0.5">¥{yen(item.unit_price)}</p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => handleQtyDecrease(item)}
                        className="w-9 h-9 rounded-lg bg-slate-200 hover:bg-slate-300 text-body text-sm font-bold flex items-center justify-center transition-colors"
                      >
                        −
                      </button>
                      <span className="w-5 text-center text-xs font-bold text-heading">{item.quantity}</span>
                      <button
                        onClick={() => handleQtyIncrease(item)}
                        className="w-9 h-9 rounded-lg bg-primary-500 hover:bg-primary-700 text-white text-sm font-bold flex items-center justify-center transition-colors"
                      >
                        +
                      </button>
                    </div>
                    <span className="text-xs font-bold text-primary-600 w-14 text-right flex-shrink-0">
                      ¥{yen((item.quantity * item.unit_price))}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 合計 + 支払いUI */}
          <div className="flex-shrink-0 border-t border-line">
            {/* 合計行 */}
            <div className="px-4 py-3.5 flex justify-between items-center bg-surface-sunken">
              <span className="text-xs font-semibold text-muted">
                {discountAmount > 0 && (
                  <span className="text-red-500 mr-1.5">−¥{yen(discountAmount)}</span>
                )}
                合計
              </span>
              <span className="text-xl font-black text-heading">¥{yen(finalTotal)}</span>
            </div>

            {/* 割引登録 / 金券 */}
            <div className="px-4 pt-4 pb-4 flex gap-4 border-b border-line">
              <button
                onClick={() => {
                  setDiscountType(savedDiscountType);
                  setDiscountInput(savedDiscountInput);
                  setShowDiscountModal(true);
                }}
                className={`flex-1 py-5 text-sm font-semibold rounded-lg border transition-colors relative ${
                  discountAmount > 0
                    ? 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100'
                    : 'bg-surface-sunken border-line text-body hover:bg-surface-sunken'
                }`}
              >
                割引登録
                {discountAmount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-none">
                    適用中
                  </span>
                )}
              </button>
              <button
                onClick={() => {
                  setTempGiftCertTotal(giftCertTotal);
                  setTempGiftCertNoChange(giftCertNoChange);
                  setShowGiftCertModal(true);
                }}
                disabled={splitMode}
                className={`flex-1 py-5 text-sm font-semibold rounded-lg border transition-colors relative ${
                  splitMode
                    ? 'bg-surface-sunken border-line text-faint cursor-not-allowed'
                    : effectiveGiftCert > 0
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                      : 'bg-surface-sunken border-line text-body hover:bg-surface-sunken'
                }`}
              >
                金券
                {effectiveGiftCert > 0 && !splitMode && (
                  <span className="absolute -top-1.5 -right-1.5 bg-emerald-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-none">
                    適用中
                  </span>
                )}
              </button>
            </div>

            {/* 支払い方法 + テンキー */}
            <div className="p-4 space-y-4">
              {/* 通常 / 分割 切替 */}
              <div className="flex rounded-lg border border-line overflow-hidden text-sm font-semibold">
                <button
                  onClick={() => switchSplitMode(false)}
                  className={`flex-1 py-2.5 transition-colors ${!splitMode ? 'bg-primary-600 text-white' : 'bg-surface text-muted hover:bg-surface-sunken'}`}
                >
                  通常
                </button>
                <button
                  onClick={() => switchSplitMode(true)}
                  className={`flex-1 py-2.5 transition-colors ${splitMode ? 'bg-primary-600 text-white' : 'bg-surface text-muted hover:bg-surface-sunken'}`}
                >
                  分割
                </button>
              </div>

              {!splitMode ? (
                <>
              {/* 現金ボタン */}
              <button
                onClick={() => { setPaymentMethod('cash'); setShowOtherPayment(false); setReceivedInput(''); }}
                className={`w-full py-6 rounded-xl text-xl font-bold transition-all ${
                  paymentMethod === 'cash'
                    ? 'bg-primary-600 text-white shadow-md'
                    : 'bg-surface-sunken text-body hover:bg-surface-hover'
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
                className={`w-full py-5 rounded-xl text-sm font-medium transition-all border ${
                  paymentMethod !== 'cash'
                    ? 'border-primary-500 bg-primary-50 text-primary-700'
                    : 'border-line bg-surface text-body hover:bg-surface-sunken'
                }`}
              >
                その他支払
              </button>

              {/* カード / 電子マネー サブ選択 */}
              {showOtherPayment && (
                <div className="flex gap-4">
                  {[{ id: 'card', label: 'カード' }, { id: 'emoney', label: '電子マネー' }].map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setPaymentMethod(m.id)}
                      className={`flex-1 py-3.5 rounded-xl text-sm font-semibold border transition-all ${
                        paymentMethod === m.id
                          ? 'border-primary-500 bg-primary-50 text-primary-700'
                          : 'border-line bg-surface text-body hover:bg-surface-sunken'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              )}

              {/* 受取金額ディスプレイ + 残高・おつり */}
              <div className="bg-surface border border-line rounded-xl overflow-hidden">
                <div className="px-4 py-3 text-right">
                  <p className="text-[10px] text-faint mb-0.5">
                    {isCash ? 'お預かり（現金）' : ({ card: 'カード', emoney: '電子マネー' }[paymentMethod] ?? 'その他')}
                  </p>
                  <p className="text-xl font-black text-heading tracking-wider">
                    ¥{receivedInput ? yen(parseInt(receivedInput, 10)) : '0'}
                  </p>
                  {isCash && remainingAfterGift > 0 && effectiveGiftCert > 0 && (
                    <p className="text-xs text-faint mt-0.5">
                      金券後残額 ¥{yen(remainingAfterGift)}
                    </p>
                  )}
                </div>
                <div className="border-t border-line px-4 py-2.5 space-y-1.5">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted">残高</span>
                    <span className={`font-semibold ${balance > 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                      ¥{yen(balance)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted">おつり</span>
                    <span className="font-bold text-heading">¥{yen(change)}</span>
                  </div>
                </div>
              </div>

              {/* テンキー */}
              <Numpad
                value={receivedInput}
                onChange={setReceivedInput}
                onConfirm={() => { if (canPay) { idemKeyRef.current = newIdempotencyKey(); setPayError(''); payMutation.mutate(); } }}
                exactAmount={remainingAfterGift}
              />
                </>
              ) : (
                <>
                  {/* 分割: 方法行（タップで選択、テンキー入力→決定で確定） */}
                  <div className="space-y-2">
                    {SPLIT_METHODS.map((m) => {
                      const isActive = splitActive === m.id;
                      const shown = isActive && splitInput !== '' ? (parseInt(splitInput, 10) || 0) : splitAmounts[m.id];
                      return (
                        <button
                          key={m.id}
                          onClick={() => selectSplitMethod(m.id)}
                          className={`w-full flex items-center justify-between px-4 py-2.5 rounded-xl border transition-all ${
                            isActive
                              ? 'border-primary-500 bg-primary-50 ring-1 ring-primary-300'
                              : 'border-line bg-surface hover:bg-surface-sunken'
                          }`}
                        >
                          <span className={`text-sm font-semibold ${isActive ? 'text-primary-700' : 'text-body'}`}>
                            {m.label}
                          </span>
                          <span className={`text-lg font-black ${isActive && splitInput !== '' ? 'text-primary-600' : 'text-heading'}`}>
                            ¥{yen(shown)}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* 分割サマリ（差額 / おつり） */}
                  <div className="bg-surface border border-line rounded-xl px-4 py-2.5 space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted">会計総額</span>
                      <span className="font-semibold text-heading">¥{yen(finalTotal)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted">入力済</span>
                      <span className="font-semibold text-heading">¥{yen(enteredSum)}</span>
                    </div>
                    {splitChange > 0 ? (
                      <div className="flex justify-between text-sm">
                        <span className="text-emerald-600">おつり</span>
                        <span className="font-bold text-emerald-600">¥{yen(splitChange)}</span>
                      </div>
                    ) : (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted">差額</span>
                        <span className={`font-bold ${splitRemaining === 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                          ¥{yen(splitRemaining)}
                        </span>
                      </div>
                    )}
                    {cashlessSum > finalTotal && (
                      <p className="text-xs text-red-500 pt-0.5">カード・電子マネーが会計総額を超えています</p>
                    )}
                  </div>

                  {/* 分割クリア */}
                  <button
                    onClick={clearSplit}
                    className="w-full py-2.5 text-sm font-medium bg-surface-sunken hover:bg-surface-hover text-body rounded-lg transition-colors"
                  >
                    分割クリア
                  </button>

                  {/* テンキー（決定で選択中の方法を確定） */}
                  <Numpad
                    value={splitInput}
                    onChange={onSplitInput}
                    onConfirm={commitSplit}
                    exactAmount={splitFillValue}
                  />
                </>
              )}
            </div>

            {/* 会計ボタン */}
            <div className="px-4 pb-6 pt-2 border-t border-line">
              {payError && (
                <div className="flex items-start gap-2 p-3 mb-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
                  ⚠ {payError}
                </div>
              )}
              <button
                onClick={() => { if (canPay) { idemKeyRef.current = newIdempotencyKey(); setPayError(''); payMutation.mutate(); } }}
                disabled={!canPay}
                className="w-full py-6 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white rounded-xl font-black transition-colors text-xl shadow-sm"
              >
                {payMutation.isPending ? '処理中...' : '会計する'}
              </button>
            </div>
          </div>

        </div>
      </div>
      {priceEditItem && (
        <CustomPriceModal
          defaultName={priceEditItem.defaultName}
          defaultPrice={priceEditItem.defaultPrice}
          onConfirm={handlePriceConfirm}
          onClose={() => setPriceEditItem(null)}
          isPending={false}
        />
      )}
      {choiceItem && (
        <ChoiceModal
          title={choiceItem.title}
          choices={choiceItem.choices}
          allowMultiple={choiceItem.allowMultiple}
          allowQuantity={choiceItem.allowQuantity}
          onConfirm={handleChoiceConfirm}
          onClose={() => setChoiceItem(null)}
        />
      )}
    </>
  );
}
