import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import socket from '../../socket';
import MenuGrid from './MenuGrid';
import { DiscountModal, PaymentResultModal } from './PaymentModal';

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
      className="h-10 rounded-xl text-sm font-bold bg-white border border-slate-200 hover:bg-slate-50 text-slate-900 shadow-sm transition-all active:scale-95"
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-3 gap-1.5">
        <button type="button" onClick={() => handleKey('C')}
          className="h-10 rounded-xl text-sm font-bold bg-slate-100 hover:bg-slate-200 text-slate-600 transition-all active:scale-95">
          C
        </button>
        <button type="button" onClick={() => handleKey('残額')}
          className="col-span-2 h-10 rounded-xl text-sm font-bold bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 transition-all active:scale-95">
          残額
        </button>
      </div>
      <div className="grid grid-cols-3 gap-1.5">{['7','8','9'].map(digitBtn)}</div>
      <div className="grid grid-cols-3 gap-1.5">{['4','5','6'].map(digitBtn)}</div>
      <div className="grid grid-cols-3 gap-1.5">{['1','2','3'].map(digitBtn)}</div>
      <div className="grid grid-cols-3 gap-1.5">
        {['0','00'].map(digitBtn)}
        <button type="button" onClick={() => handleKey('決定')}
          className="h-10 rounded-xl text-sm font-bold bg-primary-600 hover:bg-primary-700 text-white transition-all active:scale-95 shadow-sm">
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
    mutationFn: () => api.pay(order.id, paymentMethod, discountAmount, null, 0, false),
    onSuccess: () => {
      setPayResult({
        tableName:       '即会計',
        elapsedTime:     '--:--',
        itemsSubtotal,
        chargeAmount:    0,
        lateNightAmount: 0,
        discountAmount,
        giftCertAmount:  0,
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
  };

  // ── 金額計算 ──
  const itemsSubtotal  = order?.items?.reduce((s, i) => s + i.quantity * i.unit_price, 0) ?? 0;
  const discountNum    = parseFloat(savedDiscountInput) || 0;
  const discountAmount = savedDiscountType === 'amount'
    ? Math.min(discountNum, itemsSubtotal)
    : Math.round(itemsSubtotal * Math.min(discountNum, 100) / 100);
  const finalTotal = Math.max(itemsSubtotal - discountAmount, 0);

  const isCash   = paymentMethod === 'cash';
  const received = parseInt(receivedInput, 10) || 0;
  const balance  = Math.max(finalTotal - received, 0);
  const change   = Math.max(received - finalTotal, 0);

  const canPay = !!order && (order.items?.length ?? 0) > 0 && !payMutation.isPending
    && (isCash ? received >= finalTotal : true);

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
                        className="w-6 h-6 rounded-md bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold flex items-center justify-center transition-colors disabled:opacity-50"
                      >
                        −
                      </button>
                      <span className="w-5 text-center text-xs font-bold text-slate-900">{item.quantity}</span>
                      <button
                        onClick={() => handleQtyIncrease(item)}
                        disabled={addItemMutation.isPending}
                        className="w-6 h-6 rounded-md bg-primary-500 hover:bg-primary-700 text-white text-xs font-bold flex items-center justify-center transition-colors disabled:opacity-50"
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
            <div className="px-4 py-2.5 flex justify-between items-center bg-slate-50">
              <span className="text-xs font-semibold text-slate-500">
                {discountAmount > 0 && (
                  <span className="text-red-500 mr-1.5">−¥{discountAmount.toLocaleString()}</span>
                )}
                合計
              </span>
              <span className="text-xl font-black text-slate-900">¥{finalTotal.toLocaleString()}</span>
            </div>

            <div className="px-3 pb-3 pt-2 space-y-2">
              {/* 支払い方法 */}
              <div className="flex gap-1.5">
                <button
                  onClick={() => { setPaymentMethod('cash'); setShowOtherPayment(false); setReceivedInput(''); }}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all ${
                    paymentMethod === 'cash'
                      ? 'bg-primary-600 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  現金
                </button>
                <button
                  onClick={() => {
                    const next = !showOtherPayment;
                    setShowOtherPayment(next);
                    setReceivedInput('');
                    if (next && paymentMethod === 'cash') setPaymentMethod('card');
                    if (!next) setPaymentMethod('cash');
                  }}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-medium border transition-all ${
                    paymentMethod !== 'cash'
                      ? 'border-primary-500 bg-primary-50 text-primary-700'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  その他
                </button>
              </div>

              {/* カード / 電子マネー */}
              {showOtherPayment && (
                <div className="flex gap-1.5">
                  {[{ id: 'card', label: 'カード' }, { id: 'emoney', label: '電子マネー' }].map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setPaymentMethod(m.id)}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                        paymentMethod === m.id
                          ? 'border-primary-500 bg-primary-50 text-primary-700'
                          : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              )}

              {/* 現金: お預かり表示 + テンキー */}
              {isCash && (
                <>
                  <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                    <div className="px-3 py-2 text-right">
                      <p className="text-[10px] text-slate-400 mb-0.5">お預かり（現金）</p>
                      <p className="text-lg font-black text-slate-900">
                        ¥{receivedInput ? parseInt(receivedInput, 10).toLocaleString() : '0'}
                      </p>
                    </div>
                    <div className="border-t border-slate-100 px-3 py-2 flex gap-3">
                      <div className="flex justify-between flex-1">
                        <span className="text-xs text-slate-500">残高</span>
                        <span className={`text-xs font-semibold ${balance > 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                          ¥{balance.toLocaleString()}
                        </span>
                      </div>
                      <div className="flex justify-between flex-1">
                        <span className="text-xs text-slate-500">おつり</span>
                        <span className="text-xs font-bold text-slate-900">¥{change.toLocaleString()}</span>
                      </div>
                    </div>
                  </div>

                  <Numpad
                    value={receivedInput}
                    onChange={setReceivedInput}
                    onConfirm={() => { if (canPay) payMutation.mutate(); }}
                    exactAmount={finalTotal}
                  />
                </>
              )}

              {/* 割引登録 */}
              <button
                onClick={() => {
                  setDiscountType(savedDiscountType);
                  setDiscountInput(savedDiscountInput);
                  setShowDiscountModal(true);
                }}
                className={`w-full py-2 text-xs font-medium rounded-lg border transition-colors ${
                  discountAmount > 0
                    ? 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                割引登録{discountAmount > 0 && ` (−¥${discountAmount.toLocaleString()})`}
              </button>

              {/* 会計ボタン */}
              <button
                onClick={() => { if (canPay) payMutation.mutate(); }}
                disabled={!canPay}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white rounded-xl font-bold transition-colors text-sm shadow-sm"
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
