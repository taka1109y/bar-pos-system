import { useQuery } from '@tanstack/react-query';
import { api } from '../../api';
import { TZ, todayJST } from '../../utils/tz';

export default function KitchenHistoryModal({ onClose }) {
  const today = todayJST();

  const { data: settings } = useQuery({
    queryKey: ['system-settings'],
    queryFn: () => api.getSystemSettings(),
  });

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['kitchenHistory', today, settings?.register_opened_at],
    queryFn: () => api.getKitchenHistory(today, settings?.register_opened_at ?? null),
    enabled: !!settings,
  });

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 fade-in">
      <div className="bg-white border border-slate-200 rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col pop-in">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <h3 className="text-base font-bold text-slate-900">本日の提供履歴</h3>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-100 text-slate-500">
              {rows.length} 件
            </span>
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

        <div className="overflow-y-auto">
          {isLoading ? (
            <p className="text-sm text-slate-400 text-center py-16">読み込み中...</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-16">本日の提供履歴はありません</p>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-slate-200 sticky top-0">
                  <th scope="col" className="text-left py-2.5 px-4 text-xs font-medium text-slate-500 uppercase tracking-wider">受注時刻</th>
                  <th scope="col" className="text-left py-2.5 px-4 text-xs font-medium text-slate-500 uppercase tracking-wider">テーブル</th>
                  <th scope="col" className="text-left py-2.5 px-4 text-xs font-medium text-slate-500 uppercase tracking-wider">商品名</th>
                  <th scope="col" className="text-right py-2.5 px-4 text-xs font-medium text-slate-500 uppercase tracking-wider">数量</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => (
                  <tr key={row.itemId} className={idx < rows.length - 1 ? 'border-b border-slate-100' : ''}>
                    <td className="py-3 px-4 text-sm text-slate-600 font-mono whitespace-nowrap">
                      {new Date(row.orderedAt).toLocaleString('ja-JP', {
                        timeZone: TZ,
                        month: 'numeric',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </td>
                    <td className="py-3 px-4 text-sm font-bold text-slate-900">{row.tableName}</td>
                    <td className="py-3 px-4 text-sm text-slate-700">{row.itemName}</td>
                    <td className="py-3 px-4 text-sm text-slate-900 text-right font-semibold">× {row.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
