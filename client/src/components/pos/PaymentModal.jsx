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
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-slate-800 rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl">
        <h2 className="text-xl font-bold text-white mb-4">会計確認</h2>
        <p className="text-slate-400 text-sm mb-4">{table.name}</p>

        {/* 明細 */}
        <div className="space-y-2 mb-4 max-h-60 overflow-y-auto">
          {order.items.map((item) => (
            <div key={item.id} className="flex justify-between text-sm">
              <span className="text-slate-300">{item.item_name} × {item.quantity}</span>
              <span className="text-white font-medium">¥{(item.quantity * item.unit_price).toLocaleString()}</span>
            </div>
          ))}
        </div>

        <div className="border-t border-slate-600 pt-3 flex justify-between items-center mb-6">
          <span className="text-slate-400">合計</span>
          <span className="text-2xl font-bold text-yellow-300">¥{total.toLocaleString()}</span>
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-xl font-medium transition-colors"
          >
            キャンセル
          </button>
          <button
            onClick={() => payMutation.mutate()}
            disabled={payMutation.isPending}
            className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl font-bold transition-colors"
          >
            {payMutation.isPending ? '処理中...' : '支払い完了'}
          </button>
        </div>
      </div>
    </div>
  );
}
