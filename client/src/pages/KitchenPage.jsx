import { useEffect, useCallback, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import socket from '../socket';
import KitchenHistoryModal from './kitchen/KitchenHistoryModal';

function elapsed(orderedAt) {
  const diff = Math.floor((Date.now() - new Date(orderedAt).getTime()) / 1000);
  if (diff < 60) return `${diff}秒`;
  const m = Math.floor(diff / 60);
  const s = diff % 60;
  return `${m}分${s}秒`;
}

let _audioCtx = null;
function getAudioCtx() {
  if (!_audioCtx) _audioCtx = new AudioContext();
  return _audioCtx;
}

function playBeep(ctx) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.frequency.value = 880;
  gain.gain.setValueAtTime(0.3, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
  osc.start();
  osc.stop(ctx.currentTime + 0.4);
}

function playNotification() {
  try {
    const ctx = getAudioCtx();
    if (ctx.state === 'suspended') {
      ctx.resume().then(() => playBeep(ctx));
    } else {
      playBeep(ctx);
    }
  } catch (_) {}
}

function RecipeModal({ menuItemId, itemName, onClose }) {
  const { data, isLoading } = useQuery({
    queryKey: ['recipe-detail-kitchen', menuItemId],
    queryFn: () => api.getRecipeByMenu(menuItemId),
    enabled: !!menuItemId,
    staleTime: 60_000,
  });

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white border border-slate-200 rounded-xl shadow-xl w-full max-w-md mx-4 max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 flex-shrink-0">
          <div>
            <h3 className="text-base font-bold text-slate-900">{itemName}</h3>
            <p className="text-xs text-slate-400 mt-0.5">レシピ</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div className="px-5 py-4 overflow-y-auto space-y-4">
          {isLoading ? (
            <p className="text-sm text-slate-400 text-center py-6">読み込み中...</p>
          ) : !data || data.ingredients.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-6">レシピが登録されていません</p>
          ) : (
            <>
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50 border-b border-slate-200">
                      <th scope="col" className="text-left py-2.5 px-4 text-xs font-medium text-slate-500 uppercase tracking-wider">材料</th>
                      <th scope="col" className="text-right py-2.5 px-4 text-xs font-medium text-slate-500 uppercase tracking-wider">使用量</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.ingredients.map((ing, idx) => (
                      <tr key={ing.ingredient_id} className={idx < data.ingredients.length - 1 ? 'border-b border-slate-100' : ''}>
                        <td className="py-3 px-4 text-sm font-medium text-slate-900">{ing.ingredient_name}</td>
                        <td className="py-3 px-4 text-sm text-slate-600 text-right font-mono">
                          {ing.usage_quantity} {ing.quantity_unit}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {data.recipe_notes && (
                <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
                  <p className="text-xs font-semibold text-amber-700 mb-1.5">作り方メモ</p>
                  <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{data.recipe_notes}</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ConfirmModal({ item, title, confirmLabel, confirmClass, onConfirm, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 fade-in">
      <div className="bg-white border border-slate-200 rounded-xl p-6 w-80 shadow-xl pop-in">
        <h3 className="text-base font-bold text-slate-900 mb-2">{title}</h3>
        <p className="text-sm text-slate-500 mb-1">
          <span className="text-slate-900 font-semibold">{item.tableName}</span>
        </p>
        <p className="text-sm text-slate-700 mb-5">
          {item.itemName} × {item.quantity}
          {item.selectedOption && (
            <span className="block text-xs text-slate-500 mt-0.5">選択: {item.selectedOption}</span>
          )}
        </p>
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition-colors"
          >
            戻る
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 py-2.5 text-white text-sm font-bold rounded-lg transition-colors ${confirmClass}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function KitchenPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [cancelTarget, setCancelTarget] = useState(null);
  const [recipeTarget, setRecipeTarget] = useState(null);
  const [serveTarget, setServeTarget] = useState(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['kitchenOrders'],
    queryFn: api.getKitchenOrders,
    refetchInterval: 30_000,
  });

  const refetch = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['kitchenOrders'] });
  }, [queryClient]);

  useEffect(() => {
    // socket切断中に届いた注文を取りこぼさないよう、再接続の瞬間にも必ず最新データを取得する。
    // 通知音そのものは下の「新規アイテム検知」useEffectがrowsの差分から一元的に鳴らす。
    socket.on('order:updated',         refetch);
    socket.on('table:status_changed',  refetch);
    socket.on('kitchen:item_served',   refetch);
    socket.on('kitchen:new_item',      refetch);
    socket.on('connect',               refetch);
    return () => {
      socket.off('order:updated',        refetch);
      socket.off('table:status_changed', refetch);
      socket.off('kitchen:item_served',  refetch);
      socket.off('kitchen:new_item',     refetch);
      socket.off('connect',              refetch);
    };
  }, [refetch]);

  // rowsに新しいitemIdが現れたら通知音を鳴らす。ライブのsocketイベントだけでなく、
  // 再接続後のcatch-up・30秒ポーリングいずれの経路で新規注文が反映された場合も同じ仕組みで検知する。
  const seenItemIdsRef = useRef(null);
  useEffect(() => {
    const currentIds = new Set(rows.map((r) => r.itemId));
    if (seenItemIdsRef.current === null) {
      // 初回ロード時点で既に存在する未提供アイテムでは鳴らさない
      seenItemIdsRef.current = currentIds;
      return;
    }
    const hasNewItem = rows.some((r) => !seenItemIdsRef.current.has(r.itemId));
    seenItemIdsRef.current = currentIds;
    if (hasNewItem) playNotification();
  }, [rows]);

  // AudioContextのアンロック・可視化復帰時の再開・自動サスペンド防止(キープアライブ)
  useEffect(() => {
    const unlock = () => {
      getAudioCtx().resume().catch(() => {});
    };
    document.addEventListener('pointerdown', unlock, { once: true });
    document.addEventListener('keydown', unlock, { once: true });
    document.addEventListener('touchend', unlock, { once: true });

    // タブが非表示→可視化された際に、ブラウザ側でサスペンドされたAudioContextを再開する
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        getAudioCtx().resume().catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // iOS Safari等はタブ非表示中にAudioContextを自動サスペンドすることがあるため、
    // 人には聞こえない極小音量のビープを定期的に鳴らし続けてサスペンドを防ぐ
    const keepAliveId = setInterval(() => {
      try {
        const ctx = getAudioCtx();
        if (ctx.state !== 'running') return;
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        gain.gain.value = 0.0001;
        osc.frequency.value = 20;
        osc.start();
        osc.stop(ctx.currentTime + 0.05);
      } catch { /* noop */ }
    }, 15_000);

    return () => {
      document.removeEventListener('pointerdown', unlock);
      document.removeEventListener('keydown', unlock);
      document.removeEventListener('touchend', unlock);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearInterval(keepAliveId);
    };
  }, []);

  const serveMutation = useMutation({
    mutationFn: (itemId) => api.serveKitchenItem(itemId),
    onSuccess: () => {
      setServeTarget(null);
      queryClient.invalidateQueries({ queryKey: ['kitchenOrders'] });
    },
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
    <div className="min-h-screen bg-gray-50 text-slate-900">
      {/* ヘッダー */}
      <header className="bg-white border-b border-slate-200 px-6 py-3.5 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-amber-100 rounded-xl flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2">
              <path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/>
              <line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/>
            </svg>
          </div>
          <div>
            <h1 className="font-bold text-slate-900 text-base leading-tight">キッチン</h1>
            <p className="text-xs text-slate-400 mt-0.5">オープン注文 リアルタイム表示</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-sm font-semibold px-3 py-1.5 rounded-full ${
            rows.length === 0
              ? 'bg-slate-100 text-slate-400'
              : 'bg-amber-100 text-amber-800'
          }`}>
            {rows.length} 件対応中
          </span>
          <button
            onClick={refetch}
            className="text-xs text-slate-500 hover:text-slate-700 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors font-medium"
          >
            更新
          </button>
          <button
            onClick={() => setIsHistoryOpen(true)}
            className="text-xs text-slate-500 hover:text-slate-700 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors font-medium"
          >
            履歴
          </button>
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors font-medium"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              <polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
            管理画面へ
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
            <div className="grid grid-cols-[120px_140px_1fr_64px_100px_100px] gap-0 bg-gray-50 border-b border-slate-200 px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">
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
                const diffSec = Math.floor((now - new Date(row.orderedAt).getTime()) / 1000);
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
                        {new Date(row.orderedAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </p>
                      <p className={`text-[11px] mt-0.5 ${isOld ? 'text-red-600 font-bold' : 'text-slate-400'}`}>
                        {elapsed(row.orderedAt)}経過
                      </p>
                    </div>

                    {/* テーブル */}
                    <div>
                      <span className="text-sm font-bold text-slate-900">{row.tableName}</span>
                    </div>

                    {/* 商品名 */}
                    <div>
                      <button
                        onClick={() => row.menuItemId && setRecipeTarget({ menuItemId: row.menuItemId, itemName: row.itemName })}
                        disabled={!row.menuItemId}
                        className="-mt-4 pt-4 w-full text-left text-sm text-slate-700 font-medium hover:text-primary-600 cursor-pointer disabled:cursor-default"
                      >
                        {row.itemName}
                      </button>
                      {row.selectedOption && (
                        <p className="text-xs text-primary-600 font-semibold mt-0.5">→ {row.selectedOption}</p>
                      )}
                    </div>

                    {/* 数量 */}
                    <div className="text-center">
                      <span className="text-base font-black text-slate-900">× {row.quantity}</span>
                    </div>

                    {/* 提供完了ボタン */}
                    <div className="flex justify-center">
                      <button
                        onClick={() => setServeTarget(row)}
                        disabled={isServePending || isCancelPending}
                        className="px-3 py-1.5 bg-primary-500 hover:bg-primary-700 disabled:opacity-40 text-white text-xs font-bold rounded-lg transition-colors"
                      >
                        {isServePending ? '...' : '提供完了'}
                      </button>
                    </div>

                    {/* キャンセルボタン */}
                    <div className="flex justify-center">
                      <button
                        onClick={() => setCancelTarget(row)}
                        disabled={isServePending || isCancelPending}
                        className="px-3 py-1.5 bg-slate-100 hover:bg-red-50 hover:text-red-600 disabled:opacity-40 text-slate-500 text-xs font-semibold rounded-lg transition-colors"
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

      {recipeTarget && (
        <RecipeModal
          menuItemId={recipeTarget.menuItemId}
          itemName={recipeTarget.itemName}
          onClose={() => setRecipeTarget(null)}
        />
      )}

      {cancelTarget && (
        <ConfirmModal
          item={cancelTarget}
          title="注文をキャンセルしますか？"
          confirmLabel="キャンセルする"
          confirmClass="bg-red-500 hover:bg-red-600"
          onConfirm={() =>
            cancelMutation.mutate({ orderId: cancelTarget.orderId, itemId: cancelTarget.itemId })
          }
          onClose={() => setCancelTarget(null)}
        />
      )}

      {serveTarget && (
        <ConfirmModal
          item={serveTarget}
          title="提供完了にしますか？"
          confirmLabel="提供完了にする"
          confirmClass="bg-primary-500 hover:bg-primary-700"
          onConfirm={() => serveMutation.mutate(serveTarget.itemId)}
          onClose={() => setServeTarget(null)}
        />
      )}

      {isHistoryOpen && (
        <KitchenHistoryModal onClose={() => setIsHistoryOpen(false)} />
      )}
    </div>
  );
}
