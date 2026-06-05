import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import socket from '../../socket';
import MenuGrid from './MenuGrid';
import { DiscountModal, GiftCertModal, PaymentResultModal } from './PaymentModal';

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
      className="h-14 rounded-xl text-base font-bold bg-white border border-slate-200 hover:bg-slate-50 text-slate-900 shadow-sm transition-all active:scale-95"
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-3 gap-2.5">
        <button type="button" onClick={() => handleKey('C')}
          className="h-14 rounded-xl text-base font-bold bg-slate-100 hover:bg-slate-200 text-slate-600 transition-all active:scale-95">
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

  // 即会計専用テーブル取得（起動後は変わらないので staleTime: Infinity）
  const { data: immediateTable } = useQuery({
    queryKey: ['immediate-table'],
    queryFn: api.getImmediateTable,
    staleTime: Infinity,
  });
  const tableId = immediateTable?.id;

  // 現在のオープン注文取得
  const orderKey = ['order', tableId];
  const { data: order } = useQuery({
    queryKey: orderKey,
    queryFn: () => api.getOrderByTable(tableId),
    enabled: !!tableId,
  });

  // Socket: リアルタイム更新
  useEffect(() => {
    if (!tableId) return;
    const handler = (data) => {
      if (data.tableId !== tableId) return;
      queryClient.setQueryData(orderKey, (old) => ({
        ...(old ?? {}),
        id:                data.orderId,
        table_id:          tableId,
        items:             data.items,
        total_amount:      data.total,
        charge_amount:     0,
        charge_per_person: 0,
        guest_count:       1,
      }));
    };
    socket.on('order:updated', handler);
    return () => socket.off('order:updated', handler);
  }, [tableId]);

  // 注文作成（アイテム追加時に存在しなければ遅延作成）
  const createOrderMutation = useMutation({
    mutationFn: () => api.createOrder(tableId, 1),
  });

  const addItemMutation = useMutation({
    mutationFn: ({ orderId, menuItemId }) =>
      api.addOrderItem(orderId, { menu_item_id: menuItemId, quantity: 1 }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orderKey }),
  });

  const updateItemMutation = useMutation({
    mutationFn: ({ orderId, itemId, quantity }) =>
      api.updateOrderItem(orderId, itemId, { quantity }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orderKey }),
  });

  const payMutation = useMutation({
    mutationFn: () => api.pay(order.id, paymentMethod, discountAmount, null, effectiveGiftCert, giftCertNoChange),
    onSuccess: () => {
      setPayResult({
        tableName:       '即会計',
        elapsedTime:     '--:--',
        itemsSubtotal,
        chargeAmount:    0,
        lateNightAmount: 0,
        discountAmount,
        giftCertAmount:  effectiveGiftCert,
        finalTotal,
        paymentMethod,
        received,
        change,
      });
    },
  });

  // メニュータップ → 確認なしで即追加（注文がなければ先に作成）
  const handleAddItem = async (menuItem) => {
    if (!tableId) return;
    let orderId = order?.id;
    if (!orderId) {
      if (createOrderMutation.isPending) return;
      try {
        const newOrder = await createOrderMutation.mutateAsync();
        queryClient.setQueryData(orderKey, newOrder);
        orderId = newOrder.id;
      } catch {
        return;
      }
    }
    addItemMutation.mutate({ orderId, menuItemId: menuItem.id });
  };

  const handleQtyIncrease = (item) => {
    if (!order) return;
    addItemMutation.mutate({ orderId: order.id, menuItemId: item.menu_item_id });
  };

  const handleQtyDecrease = (item) => {
    if (!order) return;
    updateItemMutation.mutate({ orderId: order.id, itemId: item.id, quantity: item.quantity - 1 });
  };

  const handlePayResultClose = () => {
    setPayResult(null);
    queryClient.invalidateQueries({ queryKey: orderKey });
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
  };

  // ── 金額計算 ──
  const itemsSubtotal  = order?.items?.reduce((s, i) => s + i.quantity * i.unit_price, 0) ?? 0;
  const discountNum    = parseFloat(savedDiscountInput) || 0;
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

  const canPay = !!order && (order.items?.length ?? 0) > 0 && !payMutation.isPending
    && (isCash ? totalPaid >= finalTotal : true);

  const items = order?.items ?? [];

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
          />
        </div>

        {/* ─── 右パネル: 会計 ─── */}
        <div className="w-80 border-l border-slate-200 bg-white flex flex-col flex-shrink-0 relative">

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
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 flex-shrink-0">
            <p className="text-sm font-bold text-slate-900">即会計</p>
            <p className="text-[11px] text-slate-400">チャージなし・即時会計</p>
          </div>

          {/* 商品リスト */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {items.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <p className="text-xs text-slate-400 text-center px-6">
                  左のメニューから商品を追加してください
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-50">
                {items.map((item) => (
                  <div key={item.id} className="flex items-center gap-2 px-3 py-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-slate-800 truncate">{item.item_name}</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">¥{item.unit_price.toLocaleString()}</p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => handleQtyDecrease(item)}
                        disabled={updateItemMutation.isPending}
                        className="w-9 h-9 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-sm font-bold flex items-center justify-center transition-colors disabled:opacity-50"
                      >
                        −
                      </button>
                      <span className="w-5 text-center text-xs font-bold text-slate-900">{item.quantity}</span>
                      <button
                        onClick={() => handleQtyIncrease(item)}
                        disabled={addItemMutation.isPending}
                        className="w-9 h-9 rounded-lg bg-primary-500 hover:bg-primary-700 text-white text-sm font-bold flex items-center justify-center transition-colors disabled:opacity-50"
                      >
                        +
                      </button>
                    </div>
                    <span className="text-xs font-bold text-primary-600 w-14 text-right flex-shrink-0">
                      ¥{(item.quantity * item.unit_price).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 合計 + 支払いUI */}
          <div className="flex-shrink-0 border-t border-slate-200">
            {/* 合計行 */}
            <div className="px-4 py-3.5 flex justify-between items-center bg-slate-50">
              <span className="text-xs font-semibold text-slate-500">
                {discountAmount > 0 && (
                  <span className="text-red-500 mr-1.5">−¥{discountAmount.toLocaleString()}</span>
                )}
                合計
              </span>
              <span className="text-xl font-black text-slate-900">¥{finalTotal.toLocaleString()}</span>
            </div>

            {/* 割引登録 / 金券 */}
            <div className="px-4 pt-4 pb-4 flex gap-4 border-b border-slate-100">
              <button
                onClick={() => {
                  setDiscountType(savedDiscountType);
                  setDiscountInput(savedDiscountInput);
                  setShowDiscountModal(true);
                }}
                className={`flex-1 py-5 text-sm font-semibold rounded-lg border transition-colors relative ${
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
              <button
                onClick={() => {
                  setTempGiftCertTotal(giftCertTotal);
                  setTempGiftCertNoChange(giftCertNoChange);
                  setShowGiftCertModal(true);
                }}
                className={`flex-1 py-5 text-sm font-semibold rounded-lg border transition-colors relative ${
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

            {/* 支払い方法 + テンキー */}
            <div className="p-4 space-y-5">
              {/* 現金ボタン */}
              <button
                onClick={() => { setPaymentMethod('cash'); setShowOtherPayment(false); setReceivedInput(''); }}
                className={`w-full py-6 rounded-xl text-xl font-bold transition-all ${
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
                className={`w-full py-5 rounded-xl text-sm font-medium transition-all border ${
                  paymentMethod !== 'cash'
                    ? 'border-primary-500 bg-primary-50 text-primary-700'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
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
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              )}

              {/* 受取金額ディスプレイ + 残高・おつり */}
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-4 py-3 text-right">
                  <p className="text-[10px] text-slate-400 mb-0.5">
                    {isCash ? 'お預かり（現金）' : ({ card: 'カード', emoney: '電子マネー' }[paymentMethod] ?? 'その他')}
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
              <Numpad
                value={receivedInput}
                onChange={setReceivedInput}
                onConfirm={() => { if (canPay) payMutation.mutate(); }}
                exactAmount={remainingAfterGift}
              />
            </div>

            {/* 会計ボタン */}
            <div className="px-4 pb-6 pt-2 border-t border-slate-200">
              <button
                onClick={() => { if (canPay) payMutation.mutate(); }}
                disabled={!canPay}
                className="w-full py-6 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white rounded-xl font-black transition-colors text-xl shadow-sm"
              >
                {payMutation.isPending ? '処理中...' : '会計する'}
              </button>
            </div>
          </div>

        </div>
      </div>
    </>
  );
}
