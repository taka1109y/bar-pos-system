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
            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">
              注文しますか？
            </p>
            <h3 className="text-2xl font-black text-white mb-4">{item.name}</h3>
            <div className="flex items-baseline gap-3">
              <span className="text-4xl font-black text-amber-400">
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
            className="w-full py-4 bg-amber-500 hover:bg-amber-400 active:bg-amber-600 active:scale-[0.98] text-slate-900 font-black text-lg rounded-2xl transition-all shadow-xl shadow-amber-500/25 mb-3"
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
    <div className="flex flex-col h-screen bg-slate-900 overflow-hidden">
      <TickerBar />

      {/* ─── 横置き2ペインレイアウト ─── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ─── 左ペイン: メニュー ─── */}
        <div className="flex-1 flex flex-col overflow-hidden border-r border-slate-700">
          {/* ヘッダー */}
          <header className="flex items-center justify-between px-6 py-4 bg-slate-900 border-b border-slate-800 flex-shrink-0">
            <div>
              <h1 className="font-black text-white text-xl leading-tight">
                {table?.name ?? `テーブル ${tableId}`}
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">ご自由にご注文ください</p>
            </div>
          </header>

          {/* メニュースクロールエリア */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            <MenuGrid
              menuItems={menuItems}
              categories={categories}
              subcategories={subcategories}
              onAddItem={handleTapItem}
            />
          </div>
        </div>

        {/* ─── 右ペイン: 注文サマリー ─── */}
        <div className="w-80 flex flex-col bg-slate-950 flex-shrink-0">
          {/* ペインヘッダー */}
          <div className="px-5 py-4 border-b border-slate-800 flex-shrink-0">
            <p className="text-xs font-bold text-amber-400 uppercase tracking-widest">注文内容</p>
          </div>

          {/* 注文アイテムリスト */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {!order?.items?.length ? (
              <div className="flex flex-col items-center justify-center h-32 text-slate-600 text-sm gap-2">
                <span className="text-2xl">🍺</span>
                <p>まだ注文がありません</p>
              </div>
            ) : (
              order.items.map((item) => (
                <div
                  key={item.id}
                  className="bg-slate-800 rounded-xl px-4 py-3 border border-slate-700/50"
                >
                  <p className="text-sm font-semibold text-slate-100 mb-2">{item.item_name}</p>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-slate-700 hover:bg-slate-600 rounded-lg flex items-center justify-center text-slate-400 font-bold text-sm cursor-default">
                        {item.quantity}
                      </div>
                    </div>
                    <span className="text-sm font-black text-amber-400">
                      ¥{(item.quantity * item.unit_price).toLocaleString()}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* フッター合計 */}
          <div className="flex-shrink-0 border-t border-slate-800">
            {itemCount > 0 ? (
              <div className="bg-amber-500 px-5 py-4">
                <p className="text-xs text-amber-800 font-semibold">
                  合計 <span className="font-black">{itemCount}点</span>
                </p>
                <p className="text-2xl font-black text-slate-900 mt-0.5">
                  ¥{total.toLocaleString()}
                </p>
              </div>
            ) : (
              <div className="px-5 py-4 bg-slate-900">
                <p className="text-xs text-slate-600 font-medium">メニューから選んでください</p>
              </div>
            )}
          </div>
        </div>
      </div>

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
