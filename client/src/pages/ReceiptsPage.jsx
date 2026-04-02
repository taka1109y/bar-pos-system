import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';

const PAYMENT_LABEL = { cash: '現金', card: 'カード', emoney: '電子マネー' };

function fmt(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function ReceiptsPage() {
  const today = new Date().toISOString().split('T')[0];
  const [date, setDate] = useState(today);
  const [expandedId, setExpandedId] = useState(null);

  const { data: receipts = [], isLoading } = useQuery({
    queryKey: ['receipts', date],
    queryFn: () => api.getReceipts(date),
  });

  const totalRevenue = receipts.reduce((s, r) => s + r.total_amount, 0);

  return (
    <div className="p-8 max-w-3xl mx-auto">
      {/* 日付 + サマリー */}
      <div className="flex items-center gap-4 mb-6">
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-gray-600">日付</label>
          <input
            type="date"
            value={date}
            onChange={(e) => { setDate(e.target.value); setExpandedId(null); }}
            className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
          />
        </div>
        {receipts.length > 0 && (
          <div className="ml-auto flex items-center gap-5 text-sm text-gray-500">
            <span><span className="font-bold text-gray-800">{receipts.length}</span> 件</span>
            <span><span className="font-bold text-gray-800">¥{Math.floor(totalRevenue).toLocaleString()}</span> 合計</span>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-40 text-gray-400 text-sm">読み込み中...</div>
      ) : receipts.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-12 text-center shadow-sm">
          <p className="text-gray-400 text-sm">この日の伝票はありません</p>
        </div>
      ) : (
        <div className="space-y-3">
          {receipts.map((r) => {
            const isOpen = expandedId === r.id;
            return (
              <div key={r.id} className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                {/* 伝票ヘッダー行 */}
                <button
                  onClick={() => setExpandedId(isOpen ? null : r.id)}
                  className="w-full flex items-center gap-4 px-6 py-4 text-left hover:bg-gray-50 transition-colors"
                >
                  <span className="text-xs text-gray-400 font-mono w-10 flex-shrink-0">{fmt(r.closed_at)}</span>
                  <span className="text-sm font-semibold text-gray-900 flex-1">{r.table_name}</span>
                  <span className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-600 font-medium flex-shrink-0">
                    {PAYMENT_LABEL[r.payment_method] ?? r.payment_method}
                  </span>
                  <span className="text-sm font-bold text-gray-900 w-24 text-right flex-shrink-0">
                    ¥{Math.floor(r.total_amount).toLocaleString()}
                  </span>
                  <span className={`text-xs text-gray-400 transition-transform flex-shrink-0 ${isOpen ? 'rotate-90' : ''}`}>▶</span>
                </button>

                {/* 明細展開 */}
                {isOpen && (
                  <div className="border-t border-gray-100 px-6 py-4 bg-gray-50">
                    {/* 商品明細 */}
                    <div className="space-y-2.5 mb-4">
                      {(r.items ?? []).map((item, idx) => (
                        <div key={idx} className="flex items-center gap-3 text-sm">
                          <span className="flex-1 text-gray-800">{item.item_name}</span>
                          <span className="text-gray-400 text-xs w-20 text-right">
                            ¥{Math.floor(item.unit_price).toLocaleString()} × {item.quantity}
                          </span>
                          <span className="font-semibold text-gray-900 w-20 text-right">
                            ¥{Math.floor(item.unit_price * item.quantity).toLocaleString()}
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* 金額内訳 */}
                    <div className="border-t border-gray-200 pt-3 space-y-1.5">
                      {(() => {
                        const subtotal = (r.items ?? []).reduce((s, i) => s + i.unit_price * i.quantity, 0);
                        return (
                          <>
                            <div className="flex justify-between text-xs text-gray-500">
                              <span>小計（税抜き）</span>
                              <span>¥{Math.floor(subtotal).toLocaleString()}</span>
                            </div>
                            {r.late_night_amount > 0 && (
                              <div className="flex justify-between text-xs text-amber-600">
                                <span>深夜料金（{Math.round((r.late_night_rate ?? 0) * 100)}%）</span>
                                <span>¥{Math.floor(r.late_night_amount).toLocaleString()}</span>
                              </div>
                            )}
                            {r.discount_amount > 0 && (
                              <div className="flex justify-between text-xs text-gray-500">
                                <span>割引</span>
                                <span className="text-red-500">−¥{Math.floor(r.discount_amount).toLocaleString()}</span>
                              </div>
                            )}
                            <div className="flex justify-between text-xs text-gray-500">
                              <span>消費税（{Math.round((r.tax_rate ?? 0.10) * 100)}%）</span>
                              <span>¥{Math.floor(r.tax_amount ?? 0).toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between text-sm font-black text-gray-900 pt-1 border-t border-gray-200">
                              <span>合計（税込み）</span>
                              <span>¥{Math.floor(r.total_amount).toLocaleString()}</span>
                            </div>
                          </>
                        );
                      })()}
                    </div>

                    <p className="text-xs text-gray-400 mt-3">
                      伝票 #{r.id} &nbsp;·&nbsp; {new Date(r.closed_at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
