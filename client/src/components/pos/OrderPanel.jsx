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
        queryClient.setQueryData(orderKey, (old) => ({
          ...(old ?? {}),
          id: data.orderId,
          table_id: table.id,
          items: data.items,
          total_amount: data.total,
        }));
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
    mutationFn: ({ orderId, menu_item_id }) =>
      api.addOrderItem(orderId, { menu_item_id, quantity: 1 }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orderKey }),
  });

  const updateItemMutation = useMutation({
    mutationFn: ({ orderId, itemId, quantity }) =>
      api.updateOrderItem(orderId, itemId, { quantity }),
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
    <div className="flex flex-col h-full bg-white">
      {/* ヘッダー */}
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-gray-200 bg-gray-50">
        <div>
          <h2 className="font-bold text-gray-900">{table.name}</h2>
          <span className="text-xs text-gray-400">{table.capacity}席</span>
        </div>
        <button
          onClick={onClose}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-200 transition-colors text-lg leading-none"
        >
          ✕
        </button>
      </div>

      {/* スクロールエリア */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* メニューグリッド */}
        <div>
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-2">
            メニューから追加
          </p>
          <MenuGrid
            menuItems={menuItems}
            categories={categories}
            onAddItem={handleAddItem}
          />
        </div>

        {/* 注文明細 */}
        {order?.items?.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-2">
              注文明細
            </p>
            <div className="space-y-1.5">
              {order.items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-2 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2"
                >
                  <span className="flex-1 text-sm text-gray-800 font-medium truncate">
                    {item.item_name}
                  </span>
                  <span className="text-xs text-gray-400 flex-shrink-0">
                    ¥{item.unit_price.toLocaleString()}
                  </span>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => handleQtyChange(item, -1)}
                      className="w-6 h-6 rounded bg-gray-200 hover:bg-gray-300 text-gray-700 text-sm flex items-center justify-center transition-colors"
                    >
                      −
                    </button>
                    <span className="w-6 text-center text-sm font-bold text-gray-900">
                      {item.quantity}
                    </span>
                    <button
                      onClick={() => handleQtyChange(item, 1)}
                      className="w-6 h-6 rounded bg-gray-200 hover:bg-gray-300 text-gray-700 text-sm flex items-center justify-center transition-colors"
                    >
                      +
                    </button>
                  </div>
                  <span className="text-sm font-bold text-gray-900 w-16 text-right flex-shrink-0">
                    ¥{(item.quantity * item.unit_price).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* フッター */}
      <div className="px-4 py-4 border-t border-gray-200 bg-gray-50 space-y-3">
        <div className="flex justify-between items-center">
          <span className="text-sm text-gray-500 font-medium">合計金額</span>
          <span className="text-2xl font-black text-gray-900">¥{total.toLocaleString()}</span>
        </div>

        {order ? (
          <button
            onClick={() => setShowPayment(true)}
            className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-bold rounded-xl transition-colors shadow-sm"
          >
            会計する
          </button>
        ) : !isLoading ? (
          <button
            onClick={() => openOrderMutation.mutate()}
            disabled={openOrderMutation.isPending}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold rounded-xl transition-colors shadow-sm"
          >
            {openOrderMutation.isPending ? '開始中...' : '注文を開始する'}
          </button>
        ) : null}
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
