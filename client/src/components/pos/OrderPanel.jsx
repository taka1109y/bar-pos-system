import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import socket from '../../socket';
import MenuGrid from './MenuGrid';
import PaymentModal from './PaymentModal';

// ── 確認モーダル ──────────────────────────────────────────
function ConfirmModal({ title, description, confirmLabel, confirmClass, onConfirm, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 fade-in">
      <div className="bg-white rounded-xl p-6 w-80 shadow-xl pop-in border border-slate-200">
        <h3 className="text-sm font-bold text-slate-900 mb-2">{title}</h3>
        {description && <p className="text-xs text-slate-500 leading-relaxed">{description}</p>}
        <div className="flex gap-2.5 mt-5">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-sm font-medium rounded-lg transition-colors"
          >
            キャンセル
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 py-2.5 text-white text-sm font-bold rounded-xl transition-colors ${confirmClass}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 人数変更モーダル ──────────────────────────────────────
function GuestCountModal({ currentCount, onSelect, onClose, isPending }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 fade-in">
      <div className="bg-white rounded-xl p-5 w-72 shadow-xl border border-slate-200">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-slate-900">人数を変更</h3>
          <button onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div className="grid grid-cols-5 gap-2">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              onClick={() => onSelect(n)}
              disabled={isPending}
              className={`aspect-square flex flex-col items-center justify-center rounded-xl border transition-all active:scale-95 disabled:opacity-50 ${
                n === currentCount
                  ? 'bg-primary-50 border-primary-300 text-primary-700'
                  : 'bg-slate-50 border-slate-200 hover:bg-primary-50 hover:border-primary-300'
              }`}
            >
              <span className="text-lg font-black text-slate-900">{n}</span>
              <span className="text-[10px] text-slate-400">名</span>
            </button>
          ))}
        </div>
        {isPending && <p className="text-xs text-slate-400 text-center mt-3">更新中...</p>}
      </div>
    </div>
  );
}

// ── メインコンポーネント ──────────────────────────────────
export default function OrderPanel({ table, menuItems, categories, subcategories = [], onClose }) {
  const queryClient = useQueryClient();
  const [showPayment,    setShowPayment]    = useState(false);
  const [pendingAction,  setPendingAction]  = useState(null);
  const [showGuestModal, setShowGuestModal] = useState(false);

  const orderKey = ['order', table.id];

  const { data: order, isLoading } = useQuery({
    queryKey: orderKey,
    queryFn: () => api.getOrderByTable(table.id),
  });

  useEffect(() => {
    socket.emit('client:subscribe_table', { tableId: table.id });
    const handleOrderUpdated = (data) => {
      if (data.tableId === table.id) {
        queryClient.setQueryData(orderKey, (old) => ({
          ...(old ?? {}),
          id: data.orderId,
          table_id: table.id,
          items: data.items,
          total_amount: data.total,
          charge_amount: data.chargeAmount ?? old?.charge_amount,
          charge_per_person: data.chargePerPerson ?? old?.charge_per_person,
          guest_count: data.guestCount ?? old?.guest_count,
        }));
      }
    };
    const handleReconnect = () => {
      socket.emit('client:subscribe_table', { tableId: table.id });
      queryClient.invalidateQueries({ queryKey: orderKey });
    };
    socket.on('order:updated', handleOrderUpdated);
    socket.on('connect',       handleReconnect);
    return () => {
      socket.emit('client:unsubscribe_table', { tableId: table.id });
      socket.off('order:updated', handleOrderUpdated);
      socket.off('connect',       handleReconnect);
    };
  }, [table.id]);

  const openOrderMutation = useMutation({
    mutationFn: (guestCount) => api.createOrder(table.id, guestCount ?? 1),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orderKey }),
  });

  const addItemMutation = useMutation({
    mutationFn: ({ orderId, menu_item_id }) =>
      api.addOrderItem(orderId, { menu_item_id, quantity: 1 }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orderKey }),
  });

  const updateItemMutation = useMutation({
    mutationFn: ({ orderId, itemId, quantity }) =>
      api.updateOrderItem(orderId, itemId, { quantity }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orderKey }),
  });

  const updateGuestCountMutation = useMutation({
    mutationFn: (guestCount) => api.updateGuestCount(order.id, guestCount),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orderKey });
      setShowGuestModal(false);
    },
  });

  const handleSelectGuests = (count) => {
    openOrderMutation.mutate(count);
  };

  // ── 確認付きアクション ────────────────────────────────
  const handleAddItem = (menuItem) => {
    setPendingAction({
      label:        '追加する',
      confirmClass: 'bg-primary-500 hover:bg-primary-700',
      title:        `「${menuItem.name}」を追加しますか？`,
      description:  `${table.name} の注文に追加します。`,
      onConfirm: () => {
        addItemMutation.mutate({ orderId: order.id, menu_item_id: menuItem.id });
      },
    });
  };

  const handleQtyIncrease = (item) => {
    // 現在価格で新規追加（価格が変わっていれば別行、同じなら既存行に積む）
    setPendingAction({
      label:        '追加する',
      confirmClass: 'bg-primary-500 hover:bg-primary-700',
      title:        `「${item.item_name}」をもう1杯追加しますか？`,
      description:  '注文時の現在価格で追加されます。',
      onConfirm: () => {
        addItemMutation.mutate({ orderId: order.id, menu_item_id: item.menu_item_id });
      },
    });
  };

  const handleQtyDecrease = (item) => {
    const isDelete = item.quantity === 1;
    setPendingAction({
      label:        isDelete ? '削除する' : '減らす',
      confirmClass: isDelete ? 'bg-red-600 hover:bg-red-700' : 'bg-primary-500 hover:bg-primary-700',
      title:        isDelete ? `「${item.item_name}」を削除しますか？` : `「${item.item_name}」を減らしますか？`,
      description:  isDelete ? '注文明細から取り除きます。' : `${item.quantity} → ${item.quantity - 1} に変更します。`,
      onConfirm: () => {
        updateItemMutation.mutate({ orderId: order.id, itemId: item.id, quantity: item.quantity - 1 });
      },
    });
  };

  const handleConfirm = () => {
    pendingAction?.onConfirm();
    setPendingAction(null);
  };

  const chargeAmt = parseFloat(order?.charge_amount) || 0;
  const total = (order?.items?.reduce((s, i) => s + i.quantity * i.unit_price, 0) ?? 0) + chargeAmt;

  // 注文なし（ローディング完了後）は人数選択画面を表示
  if (!isLoading && !order) {
    return (
      <div className="flex flex-col flex-1 bg-white overflow-hidden">
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-slate-50 flex-shrink-0">
          <div>
            <h2 className="font-bold text-slate-900">{table.name}</h2>
          </div>
          <button
            onClick={onClose}
            className="w-11 h-11 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* 人数選択 */}
        <div className="flex-1 flex flex-col items-center justify-center p-6 gap-6">
          <div className="text-center">
            <p className="text-base font-bold text-slate-900 mb-1">何名様ですか？</p>
            <p className="text-xs text-slate-400">人数に応じたチャージが設定されます</p>
          </div>

          <div className="grid grid-cols-5 gap-2 w-full">
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                onClick={() => handleSelectGuests(n)}
                disabled={openOrderMutation.isPending}
                className="aspect-square flex flex-col items-center justify-center rounded-xl bg-slate-50 border border-slate-200 hover:bg-primary-50 hover:border-primary-300 hover:text-primary-700 transition-all active:scale-95 disabled:opacity-50"
              >
                <span className="text-xl font-black text-slate-900">{n}</span>
                <span className="text-[10px] text-slate-400 mt-0.5">名</span>
              </button>
            ))}
          </div>

          {openOrderMutation.isPending && (
            <p className="text-xs text-slate-400">オーダーを作成中...</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 bg-white overflow-hidden">
      {/* ヘッダー */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-slate-50 flex-shrink-0">
        <div>
          <h2 className="font-bold text-slate-900">{table.name}</h2>
        </div>
        <div className="flex items-center gap-2">
          {order && (
            <button
              onClick={() => setShowGuestModal(true)}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 transition-colors text-sm font-medium text-slate-600"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
              {order.guest_count}名
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
          )}
          <button
            onClick={onClose}
            className="w-11 h-11 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>

      {/* 人数変更モーダル */}
      {showGuestModal && (
        <GuestCountModal
          currentCount={order.guest_count}
          onSelect={(n) => updateGuestCountMutation.mutate(n)}
          onClose={() => setShowGuestModal(false)}
          isPending={updateGuestCountMutation.isPending}
        />
      )}

      {/* スクロールエリア */}
      <div className="flex-1 overflow-y-auto p-5 space-y-6 min-h-0">
        {/* メニューグリッド */}
        <div>
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3">
            メニューから追加
          </p>
          <MenuGrid
            menuItems={menuItems}
            categories={categories}
            subcategories={subcategories}
            onAddItem={handleAddItem}
          />
        </div>

        {/* 注文明細 */}
        {(order?.items?.length > 0 || chargeAmt > 0) && (
          <div>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3">
              注文明細
            </p>
            <div className="space-y-2">
              {/* チャージ行 */}
              {chargeAmt > 0 && (
                <div className="flex items-center gap-3 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-slate-800 font-medium block">チャージ</span>
                    <span className="text-[11px] text-slate-400 mt-0.5 block">
                      {order.guest_count}名 × ¥{Math.floor(order.charge_per_person).toLocaleString()}
                    </span>
                  </div>
                  <span className="text-sm font-bold text-amber-600 w-16 text-right flex-shrink-0">
                    ¥{Math.floor(chargeAmt).toLocaleString()}
                  </span>
                </div>
              )}
              {order.items.map((item) => {
                const sameNameItems = order.items.filter((i) => i.item_name === item.item_name);
                const hasPriceVariants = sameNameItems.length > 1;
                return (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 bg-slate-50 border border-slate-100 rounded-xl px-4 py-3"
                  >
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-slate-800 font-medium block truncate">
                        {item.item_name}
                      </span>
                      {hasPriceVariants && (
                        <span className="text-[11px] text-slate-400 mt-0.5 block">
                          注文時 ¥{item.unit_price.toLocaleString()}
                        </span>
                      )}
                    </div>
                    {!hasPriceVariants && (
                      <span className="text-xs text-slate-400 flex-shrink-0">
                        ¥{item.unit_price.toLocaleString()}
                      </span>
                    )}
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        onClick={() => handleQtyDecrease(item)}
                        className="w-7 h-7 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-base font-bold flex items-center justify-center transition-colors"
                      >
                        −
                      </button>
                      <span className="w-7 text-center text-sm font-bold text-slate-900">
                        {item.quantity}
                      </span>
                      <button
                        onClick={() => handleQtyIncrease(item)}
                        className="w-7 h-7 rounded-lg bg-primary-500 hover:bg-primary-700 text-white text-base font-bold flex items-center justify-center transition-colors"
                      >
                        +
                      </button>
                    </div>
                    <span className="text-sm font-bold text-primary-600 w-16 text-right flex-shrink-0">
                      ¥{(item.quantity * item.unit_price).toLocaleString()}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* フッター */}
      <div className="px-5 pt-5 pb-20 border-t border-slate-200 bg-slate-50 space-y-3 flex-shrink-0">
        <div className="flex justify-between items-center">
          <span className="text-sm text-slate-500 font-medium">合計金額</span>
          <span className="text-2xl font-black text-slate-900">¥{total.toLocaleString()}</span>
        </div>

        <button
          onClick={() => setShowPayment(true)}
          className="w-full py-6 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-black rounded-xl transition-colors shadow-sm text-lg"
        >
          会計する
        </button>
      </div>

      {pendingAction && (
        <ConfirmModal
          title={pendingAction.title}
          description={pendingAction.description}
          confirmLabel={pendingAction.label}
          confirmClass={pendingAction.confirmClass}
          onConfirm={handleConfirm}
          onClose={() => setPendingAction(null)}
        />
      )}

      {showPayment && order && (
        <PaymentModal
          order={order}
          table={table}
          onClose={() => setShowPayment(false)}
          onPaid={() => {
            setShowPayment(false);
            onClose();
          }}
        />
      )}
    </div>
  );
}
