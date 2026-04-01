import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import socket from '../socket';
import usePriceStore from '../store/usePriceStore';
import TickerBar from '../components/layout/TickerBar';
import MenuGrid from '../components/pos/MenuGrid';

export default function TablePage() {
  const { tableId } = useParams();
  const tableIdNum = Number(tableId);
  const queryClient = useQueryClient();
  const { initPrices, updatePrices } = usePriceStore();
  const [callSent, setCallSent] = useState(false);

  const orderKey = ['order', tableIdNum];

  // テーブル情報
  const { data: tables = [] } = useQuery({
    queryKey: ['tables'],
    queryFn: api.getTables,
  });
  const table = tables.find((t) => t.id === tableIdNum);

  // メニュー & カテゴリ
  const { data: menuItems = [] } = useQuery({
    queryKey: ['menu'],
    queryFn: api.getMenu,
    staleTime: 60_000,
  });
  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: api.getCategories,
    staleTime: 60_000,
  });

  // 現在の注文
  const { data: order } = useQuery({
    queryKey: orderKey,
    queryFn: () => api.getOrderByTable(tableIdNum),
    enabled: !!tableIdNum,
  });

  // 価格初期化
  useEffect(() => {
    api.getPrices().then(initPrices).catch(console.error);
  }, []);

  // Socket.io
  useEffect(() => {
    socket.emit('client:subscribe_table', { tableId: tableIdNum });
    socket.on('prices:updated', ({ items }) => updatePrices(items));
    socket.on('order:updated', (data) => {
      if (data.tableId === tableIdNum) {
        queryClient.invalidateQueries({ queryKey: orderKey });
      }
    });
    return () => {
      socket.emit('client:unsubscribe_table', { tableId: tableIdNum });
      socket.off('prices:updated');
      socket.off('order:updated');
    };
  }, [tableIdNum]);

  const openOrderMutation = useMutation({
    mutationFn: () => api.createOrder(tableIdNum),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orderKey }),
  });

  const addItemMutation = useMutation({
    mutationFn: ({ orderId, menu_item_id }) =>
      api.addOrderItem(orderId, { menu_item_id, quantity: 1 }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orderKey }),
  });

  const handleAddItem = async (menuItem) => {
    let currentOrder = order;
    if (!currentOrder) {
      currentOrder = await openOrderMutation.mutateAsync();
    }
    addItemMutation.mutate({ orderId: currentOrder.id, menu_item_id: menuItem.id });
  };

  const handleCallStaff = () => {
    socket.emit('customer:call_staff', { tableId: tableIdNum });
    setCallSent(true);
    setTimeout(() => setCallSent(false), 4000);
  };

  const total = order?.items?.reduce((s, i) => s + i.quantity * i.unit_price, 0) ?? 0;

  return (
    <div className="flex flex-col min-h-screen bg-slate-900">
      {/* ティッカーバー */}
      <TickerBar />

      {/* ヘッダー */}
      <header className="flex items-center justify-between px-4 py-3 bg-slate-800 border-b border-slate-700 sticky top-0 z-10">
        <div>
          <h1 className="font-bold text-white text-lg">{table?.name ?? `テーブル ${tableId}`}</h1>
          <p className="text-xs text-slate-400">ご注文はこちらから</p>
        </div>
        <button
          onClick={handleCallStaff}
          className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${
            callSent
              ? 'bg-green-600 text-white cursor-default'
              : 'bg-amber-500 hover:bg-amber-400 text-white'
          }`}
        >
          {callSent ? '✓ 通知しました' : '🔔 スタッフを呼ぶ'}
        </button>
      </header>

      <div className="flex-1 p-4 space-y-6 pb-32">
        {/* メニュー */}
        <div>
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">メニュー</h2>
          <MenuGrid
            menuItems={menuItems}
            categories={categories}
            onAddItem={handleAddItem}
          />
        </div>

        {/* 現在の注文 */}
        {order?.items?.length > 0 && (
          <div>
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">現在の注文</h2>
            <div className="space-y-2">
              {order.items.map((item) => (
                <div key={item.id} className="flex items-center justify-between bg-slate-800 rounded-lg px-4 py-3">
                  <div>
                    <span className="text-sm text-white">{item.item_name}</span>
                    <span className="text-xs text-slate-400 ml-2">× {item.quantity}</span>
                  </div>
                  <span className="text-sm font-bold text-yellow-300">
                    ¥{(item.quantity * item.unit_price).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 固定フッター: 合計 */}
      {total > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-slate-800 border-t border-slate-700 px-4 py-4">
          <div className="flex items-center justify-between max-w-lg mx-auto">
            <div>
              <p className="text-xs text-slate-400">現在の合計</p>
              <p className="text-2xl font-black text-white">¥{total.toLocaleString()}</p>
            </div>
            <button
              onClick={handleCallStaff}
              className={`px-5 py-3 rounded-xl font-bold text-sm transition-all ${
                callSent
                  ? 'bg-green-600 text-white'
                  : 'bg-amber-500 hover:bg-amber-400 text-white'
              }`}
            >
              {callSent ? '✓ 通知済み' : '🔔 スタッフを呼ぶ'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
