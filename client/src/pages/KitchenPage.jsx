import { useEffect, useCallback, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import socket from '../socket';

function elapsed(openedAt) {
  const diff = Math.floor((Date.now() - new Date(openedAt).getTime()) / 1000);
  if (diff < 60) return `${diff}秒`;
  const m = Math.floor(diff / 60);
  const s = diff % 60;
  return `${m}分${s}秒`;
}

function CancelConfirmModal({ item, onConfirm, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 fade-in">
      <div className="bg-white border border-slate-200 rounded-2xl p-6 w-80 shadow-2xl pop-in">
        <h3 className="text-base font-bold text-slate-900 mb-2">注文をキャンセルしますか？</h3>
        <p className="text-sm text-slate-500 mb-1">
          <span className="text-slate-900 font-semibold">{item.tableName}</span>
        </p>
        <p className="text-sm text-slate-700 mb-5">
          {item.itemName} × {item.quantity}
        </p>
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-xl transition-colors"
          >
            戻る
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white text-sm font-bold rounded-xl transition-colors"
          >
            キャンセルする
          </button>
        </div>
      </div>
    </div>
  );
}

export default function KitchenPage() {
  const queryClient = useQueryClient();
  const [cancelTarget, setCancelTarget] = useState(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['kitchenOrders'],
    queryFn: api.getKitchenOrders,
    refetchInterval: 30_000,
  });

  const refetch = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['kitchenOrders'] });
  }, [queryClient]);

  useEffect(() => {
    socket.on('order:updated',         refetch);
    socket.on('table:status_changed',  refetch);
    socket.on('kitchen:item_served',   refetch);
    return () => {
      socket.off('order:updated',        refetch);
      socket.off('table:status_changed', refetch);
      socket.off('kitchen:item_served',  refetch);
    };
  }, [refetch]);

  const serveMutation = useMutation({
    mutationFn: (itemId) => api.serveKitchenItem(itemId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['kitchenOrders'] }),
  });

  const cancelMutation = useMutation({
    mutationFn: ({ orderId, itemId }) => api.deleteOrderItem(orderId, itemId),
    onSuccess: () => {
      setCancelTarget(null);
      queryClient.invalidateQueries({ queryKey: ['kitchenOrders'] });
    },
  });

  const now = Date.now();

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* ヘッダー */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-amber-100 rounded-xl flex items-center justify-center text-xl">🍳</div>
          <div>
            <h1 className="font-black text-slate-900 text-xl leading-tight">キッチン</h1>
            <p className="text-xs text-slate-400">オープン注文 リアルタイム表示</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className={`text-sm font-semibold px-3 py-1.5 rounded-full ${
            rows.length === 0
              ? 'bg-slate-100 text-slate-400'
              : 'bg-amber-100 text-amber-700'
          }`}>
            {rows.length} 件対応中
          </span>
          <button
            onClick={refetch}
            className="text-xs text-slate-400 hover:text-slate-700 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition-colors font-medium"
          >
            更新
          </button>
        </div>
      </header>

      <main className="p-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-48 text-slate-400 text-sm">
            読み込み中...
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-slate-400">
            <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center text-3xl">✓</div>
            <p className="text-lg font-semibold text-slate-600">すべての注文が完了しています</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl overflow-hidden border border-slate-200 shadow-sm">
            {/* テーブルヘッダー */}
            <div className="grid grid-cols-[120px_140px_1fr_64px_100px_100px] gap-0 bg-slate-50 border-b border-slate-200 px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">
              <span>受注時刻</span>
              <span>テーブル</span>
              <span>商品名</span>
              <span className="text-center">数量</span>
              <span className="text-center">提供完了</span>
              <span className="text-center">キャンセル</span>
            </div>

            {/* 行リスト */}
            <div className="divide-y divide-slate-100">
              {rows.map((row) => {
                const diffSec = Math.floor((now - new Date(row.openedAt).getTime()) / 1000);
                const isOld = diffSec > 600;
                const isServePending  = serveMutation.isPending  && serveMutation.variables  === row.itemId;
                const isCancelPending = cancelMutation.isPending && cancelMutation.variables?.itemId === row.itemId;

                return (
                  <div
                    key={row.itemId}
                    className={`grid grid-cols-[120px_140px_1fr_64px_100px_100px] gap-0 px-4 py-4 items-center transition-colors ${
                      isOld ? 'bg-red-50 border-l-4 border-red-500' : 'bg-white hover:bg-slate-50'
                    }`}
                  >
                    {/* 受注時刻 */}
                    <div>
                      <p className="text-sm text-slate-700 font-mono font-semibold">
                        {new Date(row.openedAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </p>
                      <p className={`text-[11px] mt-0.5 ${isOld ? 'text-red-600 font-bold' : 'text-slate-400'}`}>
                        {elapsed(row.openedAt)}経過
                      </p>
                    </div>

                    {/* テーブル */}
                    <div>
                      <span className="text-sm font-bold text-slate-900">{row.tableName}</span>
                    </div>

                    {/* 商品名 */}
                    <div>
                      <span className="text-sm text-slate-700 font-medium">{row.itemName}</span>
                    </div>

                    {/* 数量 */}
                    <div className="text-center">
                      <span className="text-base font-black text-slate-900">× {row.quantity}</span>
                    </div>

                    {/* 提供完了ボタン */}
                    <div className="flex justify-center">
                      <button
                        onClick={() => serveMutation.mutate(row.itemId)}
                        disabled={isServePending || isCancelPending}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-bold rounded-lg transition-colors"
                      >
                        {isServePending ? '...' : '提供完了'}
                      </button>
                    </div>

                    {/* キャンセルボタン */}
                    <div className="flex justify-center">
                      <button
                        onClick={() => setCancelTarget(row)}
                        disabled={isServePending || isCancelPending}
                        className="px-3 py-1.5 bg-slate-100 hover:bg-red-100 hover:text-red-700 disabled:opacity-40 text-slate-500 text-xs font-bold rounded-lg transition-colors"
                      >
                        {isCancelPending ? '...' : 'キャンセル'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>

      {cancelTarget && (
        <CancelConfirmModal
          item={cancelTarget}
          onConfirm={() =>
            cancelMutation.mutate({ orderId: cancelTarget.orderId, itemId: cancelTarget.itemId })
          }
          onClose={() => setCancelTarget(null)}
        />
      )}
    </div>
  );
}
