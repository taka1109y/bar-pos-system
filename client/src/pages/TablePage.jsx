import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import socket from '../socket';
import usePriceStore from '../store/usePriceStore';
import TickerBar from '../components/layout/TickerBar';
import MenuGrid from '../components/pos/MenuGrid';

// ───────────────────────────────────────────
// 注文確認ボトムシート
// ───────────────────────────────────────────
function ConfirmModal({ item, livePrice, onConfirm, onCancel }) {
  const price = livePrice?.current_price ?? item.current_price;
  const pctChange = livePrice?.pct_change ?? 0;
  const isUp = pctChange > 0;

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-40 fade-in" onClick={onCancel} />
      <div className="fixed bottom-0 left-0 right-0 z-50 slide-up">
        <div className="bg-slate-800 rounded-t-3xl px-6 pt-5 pb-12 max-w-lg mx-auto border-t border-slate-700/60">
          <div className="w-10 h-1 bg-slate-600 rounded-full mx-auto mb-6" />

          <div className="mb-8">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2">
              注文しますか？
            </p>
            <h3 className="text-2xl font-black text-white mb-4">{item.name}</h3>
            <div className="flex items-baseline gap-3">
              <span className="text-4xl font-black text-yellow-300">
                ¥{price.toLocaleString()}
              </span>
              {item.is_drink && pctChange !== 0 && (
                <span className={`text-sm font-bold ${isUp ? 'text-green-400' : 'text-red-400'}`}>
                  {isUp ? '▲' : '▼'}{Math.abs(pctChange).toFixed(1)}%
                </span>
              )}
            </div>
          </div>

          <button
            onClick={() => onConfirm(1)}
            className="w-full py-4 bg-amber-500 hover:bg-amber-400 active:bg-amber-600 active:scale-[0.98] text-white font-black text-lg rounded-2xl transition-all shadow-xl shadow-amber-500/25 mb-3"
          >
            注文する
          </button>
          <button
            onClick={onCancel}
            className="w-full py-3 text-slate-400 hover:text-slate-300 text-sm font-medium transition-colors"
          >
            キャンセル
          </button>
        </div>
      </div>
    </>
  );
}

// ───────────────────────────────────────────
// メインページ
// ───────────────────────────────────────────
export default function TablePage() {
  const { tableId } = useParams();
  const tableIdNum = Number(tableId);
  const queryClient = useQueryClient();
  const { initPrices, updatePrices, prices } = usePriceStore();
  const [confirmItem, setConfirmItem] = useState(null);

  const orderKey = ['order', tableIdNum];

  const { data: tables = [] } = useQuery({ queryKey: ['tables'], queryFn: api.getTables });
  const table = tables.find((t) => t.id === tableIdNum);

  const { data: menuItems = [] } = useQuery({ queryKey: ['menu'], queryFn: api.getMenu, staleTime: 60_000 });
  const { data: categories = [] } = useQuery({ queryKey: ['categories'], queryFn: api.getCategories, staleTime: 60_000 });
  const { data: subcategories = [] } = useQuery({ queryKey: ['subcategories'], queryFn: api.getSubcategories, staleTime: 60_000 });
  const { data: order } = useQuery({ queryKey: orderKey, queryFn: () => api.getOrderByTable(tableIdNum), enabled: !!tableIdNum });

  useEffect(() => {
    api.getPrices().then(initPrices).catch(console.error);
  }, []);

  useEffect(() => {
    socket.emit('client:subscribe_table', { tableId: tableIdNum });

    const handlePricesUpdated = ({ items }) => updatePrices(items);
    const handlePricesSync    = ({ items }) => initPrices(items);
    const handleReconnect     = () => api.getPrices().then(initPrices).catch(console.error);
    const handleOrderUpdated  = (data) => {
      if (data.tableId === tableIdNum) {
        queryClient.setQueryData(orderKey, (old) => ({
          ...(old ?? {}),
          id: data.orderId,
          table_id: tableIdNum,
          items: data.items,
          total_amount: data.total,
        }));
      }
    };

    socket.on('prices:updated', handlePricesUpdated);
    socket.on('prices:sync',    handlePricesSync);
    socket.on('connect',        handleReconnect);
    socket.on('order:updated',  handleOrderUpdated);

    return () => {
      socket.emit('client:unsubscribe_table', { tableId: tableIdNum });
      socket.off('prices:updated', handlePricesUpdated);
      socket.off('prices:sync',    handlePricesSync);
      socket.off('connect',        handleReconnect);
      socket.off('order:updated',  handleOrderUpdated);
    };
  }, [tableIdNum]);

  const openOrderMutation = useMutation({
    mutationFn: () => api.createOrder(tableIdNum),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orderKey }),
  });

  const addItemMutation = useMutation({
    mutationFn: ({ orderId, menu_item_id, quantity }) =>
      api.addOrderItem(orderId, { menu_item_id, quantity }),
    onMutate: async ({ menu_item_id, quantity, price, name }) => {
      await queryClient.cancelQueries({ queryKey: orderKey });
      const previous = queryClient.getQueryData(orderKey);
      queryClient.setQueryData(orderKey, (old) => {
        if (!old) return old;
        const existing = old.items?.find((i) => i.menu_item_id === menu_item_id);
        const newItems = existing
          ? old.items.map((i) => i.menu_item_id === menu_item_id ? { ...i, quantity: i.quantity + quantity } : i)
          : [...(old.items ?? []), { id: `temp-${Date.now()}`, menu_item_id, item_name: name, unit_price: price, quantity }];
        return { ...old, items: newItems };
      });
      return { previous };
    },
    onError: (_err, _vars, context) => {
      queryClient.setQueryData(orderKey, context.previous);
    },
  });

  const handleTapItem = (menuItem) => setConfirmItem(menuItem);

  const handleConfirmAdd = async (qty) => {
    const item = confirmItem;
    setConfirmItem(null);
    const livePrice = prices[item.id];
    const price = livePrice?.current_price ?? item.current_price;
    let currentOrder = order;
    if (!currentOrder) currentOrder = await openOrderMutation.mutateAsync();
    addItemMutation.mutate({ orderId: currentOrder.id, menu_item_id: item.id, quantity: qty, price, name: item.name });
  };

  const total     = order?.items?.reduce((s, i) => s + i.quantity * i.unit_price, 0) ?? 0;
  const itemCount = order?.items?.reduce((s, i) => s + i.quantity, 0) ?? 0;

  return (
    <div className="flex flex-col min-h-screen bg-slate-900">
      <TickerBar />

      {/* ヘッダー */}
      <header className="flex items-center justify-between px-5 py-4 bg-slate-800/90 backdrop-blur-sm border-b border-slate-700/60 sticky top-0 z-10">
        <div>
          <h1 className="font-black text-white text-lg leading-tight">
            {table?.name ?? `テーブル ${tableId}`}
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">ご自由にご注文ください</p>
        </div>
      </header>

      {/* コンテンツ */}
      <div className="flex-1 px-5 pt-6 pb-40 space-y-8">
        {/* メニュー */}
        <section>
          <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest mb-3">
            Menu
          </p>
          <MenuGrid
            menuItems={menuItems}
            categories={categories}
            subcategories={subcategories}
            onAddItem={handleTapItem}
          />
        </section>

        {/* 現在の注文 */}
        {order?.items?.length > 0 && (
          <section>
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest mb-3">
              Your Order
            </p>
            <div className="space-y-2.5">
              {order.items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between bg-slate-800 rounded-2xl px-5 py-4 border border-slate-700/50"
                >
                  <div>
                    <p className="text-sm font-semibold text-white">{item.item_name}</p>
                    <p className="text-xs text-slate-500 mt-1">× {item.quantity}</p>
                  </div>
                  <span className="text-sm font-black text-yellow-300">
                    ¥{(item.quantity * item.unit_price).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* 固定フッター: カートサマリー */}
      {itemCount > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-20 px-5 pb-8 pt-4 bg-gradient-to-t from-slate-900 via-slate-900/95 to-transparent">
          <div className="bg-slate-800 border border-slate-700/60 rounded-2xl px-5 py-4 shadow-2xl max-w-lg mx-auto">
            <p className="text-xs text-slate-400 font-medium">
              合計 <span className="text-slate-300 font-bold">{itemCount}点</span>
            </p>
            <p className="text-2xl font-black text-white mt-1">
              ¥{total.toLocaleString()}
            </p>
          </div>
        </div>
      )}

      {/* 注文確認モーダル */}
      {confirmItem && (
        <ConfirmModal
          item={confirmItem}
          livePrice={prices[confirmItem.id]}
          onConfirm={handleConfirmAdd}
          onCancel={() => setConfirmItem(null)}
        />
      )}
    </div>
  );
}
