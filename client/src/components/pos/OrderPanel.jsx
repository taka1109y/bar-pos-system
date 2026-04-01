import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import socket from '../../socket';
import MenuGrid from './MenuGrid';
import PaymentModal from './PaymentModal';

export default function OrderPanel({ table, menuItems, categories, onClose }) {
  const queryClient = useQueryClient();
  const [showPayment, setShowPayment] = useState(false);

  const orderKey = ['order', table.id];

  const { data: order, isLoading } = useQuery({
    queryKey: orderKey,
    queryFn: () => api.getOrderByTable(table.id),
  });

  // Socket.io リアルタイム更新
  useEffect(() => {
    socket.emit('client:subscribe_table', { tableId: table.id });
    socket.on('order:updated', (data) => {
      if (data.tableId === table.id) {
        queryClient.invalidateQueries({ queryKey: orderKey });
      }
    });
    return () => {
      socket.emit('client:unsubscribe_table', { tableId: table.id });
      socket.off('order:updated');
    };
  }, [table.id]);

  const openOrderMutation = useMutation({
    mutationFn: () => api.createOrder(table.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orderKey }),
  });

  const addItemMutation = useMutation({
    mutationFn: ({ orderId, menu_item_id }) => api.addOrderItem(orderId, { menu_item_id, quantity: 1 }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orderKey }),
  });

  const updateItemMutation = useMutation({
    mutationFn: ({ orderId, itemId, quantity }) => api.updateOrderItem(orderId, itemId, { quantity }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orderKey }),
  });

  const handleAddItem = async (menuItem) => {
    let currentOrder = order;
    if (!currentOrder) {
      currentOrder = await openOrderMutation.mutateAsync();
    }
    addItemMutation.mutate({ orderId: currentOrder.id, menu_item_id: menuItem.id });
  };

  const handleQtyChange = (item, delta) => {
    const newQty = item.quantity + delta;
    updateItemMutation.mutate({ orderId: order.id, itemId: item.id, quantity: newQty });
  };

  const total = order?.items?.reduce((s, i) => s + i.quantity * i.unit_price, 0) ?? 0;

  return (
    <div className="flex flex-col h-full bg-slate-900 border-l border-slate-700">
      {/* ヘッダー */}
      <div className="flex items-center justify-between p-4 border-b border-slate-700">
        <div>
          <h2 className="font-bold text-white">{table.name}</h2>
          <span className="text-xs text-slate-400">{table.capacity}席</span>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">✕</button>
      </div>

      {/* メニュー */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <MenuGrid
          menuItems={menuItems}
          categories={categories}
          onAddItem={handleAddItem}
        />

        {/* 注文明細 */}
        {order?.items?.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">注文明細</h3>
            <div className="space-y-1">
              {order.items.map((item) => (
                <div key={item.id} className="flex items-center gap-2 bg-slate-800 rounded-lg px-3 py-2">
                  <span className="flex-1 text-sm text-white truncate">{item.item_name}</span>
                  <span className="text-xs text-slate-400">¥{item.unit_price.toLocaleString()}</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleQtyChange(item, -1)}
                      className="w-6 h-6 rounded bg-slate-700 hover:bg-slate-600 text-white text-sm flex items-center justify-center"
                    >−</button>
                    <span className="w-6 text-center text-sm font-bold text-white">{item.quantity}</span>
                    <button
                      onClick={() => handleQtyChange(item, 1)}
                      className="w-6 h-6 rounded bg-slate-700 hover:bg-slate-600 text-white text-sm flex items-center justify-center"
                    >+</button>
                  </div>
                  <span className="text-sm font-bold text-yellow-300 w-16 text-right">
                    ¥{(item.quantity * item.unit_price).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* フッター: 合計 & 会計ボタン */}
      <div className="p-4 border-t border-slate-700 space-y-3">
        <div className="flex justify-between items-center">
          <span className="text-slate-400">合計</span>
          <span className="text-2xl font-bold text-white">¥{total.toLocaleString()}</span>
        </div>
        {order && (
          <button
            onClick={() => setShowPayment(true)}
            className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl transition-colors"
          >
            会計する
          </button>
        )}
        {!order && !isLoading && (
          <button
            onClick={() => openOrderMutation.mutate()}
            className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl transition-colors"
          >
            注文を開始する
          </button>
        )}
      </div>

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
