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

// ── メインコンポーネント ──────────────────────────────────
export default function OrderPanel({ table, menuItems, categories, subcategories = [], onClose }) {
  const queryClient = useQueryClient();
  const [showPayment,   setShowPayment]   = useState(false);
  const [pendingAction, setPendingAction] = useState(null);

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
    socket.on('order:updated', handleOrderUpdated);
    return () => {
      socket.emit('client:unsubscribe_table', { tableId: table.id });
      socket.off('order:updated', handleOrderUpdated);
    };
  }, [table.id]);

  const openOrderMutation = useMutation({
    mutationFn: () => api.createOrder(table.id),
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

  // ── 確認付きアクション ────────────────────────────────
  const handleAddItem = (menuItem) => {
    setPendingAction({
      label:        '追加する',
      confirmClass: 'bg-primary-500 hover:bg-primary-700',
      title:        `「${menuItem.name}」を追加しますか？`,
      description:  `${table.name} の注文に追加します。`,
      onConfirm: async () => {
        let currentOrder = order;
        if (!currentOrder) {
          currentOrder = await openOrderMutation.mutateAsync();
        }
        addItemMutation.mutate({ orderId: currentOrder.id, menu_item_id: menuItem.id });
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

  return (
    <div className="flex flex-col h-full bg-white">
      {/* ヘッダー */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-slate-50 flex-shrink-0">
        <div>
          <h2 className="font-bold text-slate-900">{table.name}</h2>
        </div>
        <button
          onClick={onClose}
          className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      {/* スクロールエリア */}
      <div className="flex-1 overflow-y-auto p-5 space-y-6">
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
      <div className="px-5 py-5 border-t border-slate-200 bg-slate-50 space-y-3 flex-shrink-0">
        <div className="flex justify-between items-center">
          <span className="text-sm text-slate-500 font-medium">合計金額</span>
          <span className="text-2xl font-black text-slate-900">¥{total.toLocaleString()}</span>
        </div>

        {order ? (
          <button
            onClick={() => setShowPayment(true)}
            className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-black rounded-xl transition-colors shadow-sm text-base"
          >
            会計する
          </button>
        ) : !isLoading ? (
          <button
            onClick={() => openOrderMutation.mutate()}
            disabled={openOrderMutation.isPending}
            className="w-full py-3.5 bg-primary-500 hover:bg-primary-700 disabled:opacity-50 text-white font-bold rounded-xl transition-colors shadow-sm"
          >
            {openOrderMutation.isPending ? '開始中...' : '注文を開始する'}
          </button>
        ) : null}
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
