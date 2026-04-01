import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';

export default function PaymentModal({ order, table, onClose, onPaid }) {
  const queryClient = useQueryClient();

  const total = order.items.reduce((s, i) => s + i.quantity * i.unit_price, 0);

  const payMutation = useMutation({
    mutationFn: () => api.pay(order.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tables'] });
      queryClient.invalidateQueries({ queryKey: ['order', table.id] });
      onPaid();
    },
  });

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 fade-in">
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl pop-in border border-gray-100">
        {/* ヘッダー */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-lg font-bold text-gray-900">会計確認</h2>
            <p className="text-sm text-gray-400 mt-0.5">{table.name}</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* 明細リスト */}
        <div className="space-y-1.5 mb-4 max-h-56 overflow-y-auto">
          {order.items.map((item) => (
            <div key={item.id} className="flex justify-between text-sm py-1.5 border-b border-gray-50 last:border-0">
              <span className="text-gray-600">
                {item.item_name}
                <span className="text-gray-400 ml-1">× {item.quantity}</span>
              </span>
              <span className="text-gray-900 font-semibold">
                ¥{(item.quantity * item.unit_price).toLocaleString()}
              </span>
            </div>
          ))}
        </div>

        {/* 合計 */}
        <div className="flex justify-between items-center py-3 border-t border-gray-200 mb-5">
          <span className="text-sm font-medium text-gray-500">合計金額</span>
          <span className="text-2xl font-black text-gray-900">¥{total.toLocaleString()}</span>
        </div>

        {/* アクション */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-medium transition-colors text-sm"
          >
            キャンセル
          </button>
          <button
            onClick={() => payMutation.mutate()}
            disabled={payMutation.isPending}
            className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl font-bold transition-colors text-sm shadow-sm"
          >
            {payMutation.isPending ? '処理中...' : '支払い完了'}
          </button>
        </div>
      </div>
    </div>
  );
}
