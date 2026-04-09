import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';

const inp = 'w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 caret-primary-500 transition-colors';
const lbl = 'block text-xs font-semibold text-slate-500 mb-1.5';

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

  const totalRevenue  = receipts.reduce((s, r) => s + r.total_amount,    0);
  const totalDiscount = receipts.reduce((s, r) => s + (r.discount_amount ?? 0), 0);
  const totalGiftCert = receipts.reduce((s, r) => s + (r.gift_cert_amount ?? 0), 0);

  return (
    <div className="p-8 max-w-3xl mx-auto">
      {/* ヘッダー: 日付 + サマリー */}
      <div className="mb-6 space-y-3">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            <label className={lbl}>日付</label>
            <input
              type="date"
              value={date}
              onChange={(e) => { setDate(e.target.value); setExpandedId(null); }}
              className={inp}
              style={{ width: 'auto' }}
            />
          </div>
          {receipts.length > 0 && (
            <span className="ml-auto text-sm text-slate-500">
              <span className="font-bold text-slate-800">{receipts.length}</span> 件
            </span>
          )}
        </div>

        {/* 日次サマリーバー */}
        {receipts.length > 0 && (
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-sm">
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">総売上</p>
              <p className="text-lg font-black text-slate-900">¥{Math.floor(totalRevenue).toLocaleString()}</p>
            </div>
            <div className={`border rounded-xl px-4 py-3 shadow-sm ${totalDiscount > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-slate-200'}`}>
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">割引合計</p>
              <p className={`text-lg font-black ${totalDiscount > 0 ? 'text-red-500' : 'text-slate-400'}`}>
                {totalDiscount > 0 ? `−¥${Math.floor(totalDiscount).toLocaleString()}` : '¥0'}
              </p>
            </div>
            <div className={`border rounded-xl px-4 py-3 shadow-sm ${totalGiftCert > 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-slate-200'}`}>
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">金券合計</p>
              <p className={`text-lg font-black ${totalGiftCert > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                {totalGiftCert > 0 ? `¥${Math.floor(totalGiftCert).toLocaleString()}` : '¥0'}
              </p>
            </div>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-40 text-slate-400 text-sm">読み込み中...</div>
      ) : receipts.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center shadow-sm">
          <p className="text-slate-400 text-sm">この日の伝票はありません</p>
        </div>
      ) : (
        <div className="space-y-3">
          {receipts.map((r) => {
            const isOpen = expandedId === r.id;
            const hasDiscount  = (r.discount_amount ?? 0) > 0;
            const hasGiftCert  = (r.gift_cert_amount ?? 0) > 0;
            const hasMemo      = !!r.memo;
            return (
              <div key={r.id} className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                {/* 伝票ヘッダー行 */}
                <button
                  onClick={() => setExpandedId(isOpen ? null : r.id)}
                  className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-slate-50 transition-colors"
                >
                  <span className="text-xs text-slate-400 font-mono w-10 flex-shrink-0">{fmt(r.closed_at)}</span>
                  <span className="text-sm font-semibold text-slate-900 flex-1">{r.table_name}</span>

                  {/* バッジ群 */}
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {hasDiscount && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-600">
                        割引
                      </span>
                    )}
                    {hasGiftCert && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700">
                        金券
                      </span>
                    )}
                    {hasMemo && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700">
                        メモ
                      </span>
                    )}
                    <span className="text-xs px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 font-medium">
                      {PAYMENT_LABEL[r.payment_method] ?? r.payment_method}
                    </span>
                  </div>

                  <span className="text-sm font-bold text-slate-900 w-24 text-right flex-shrink-0">
                    ¥{Math.floor(r.total_amount).toLocaleString()}
                  </span>
                  <span className={`text-xs text-slate-400 transition-transform flex-shrink-0 ${isOpen ? 'rotate-90' : ''}`}>▶</span>
                </button>

                {/* 明細展開 */}
                {isOpen && (
                  <div className="bg-slate-50 border-t border-slate-100 px-6 py-4">
                    {/* 商品明細 */}
                    <div className="space-y-2.5 mb-4">
                      {(r.items ?? []).map((item, idx) => (
                        <div key={idx} className="flex items-center gap-3 text-sm">
                          <span className="flex-1 text-slate-800">{item.item_name}</span>
                          <span className="text-slate-400 text-xs w-20 text-right">
                            ¥{Math.floor(item.unit_price).toLocaleString()} × {item.quantity}
                          </span>
                          <span className="font-semibold text-slate-900 w-20 text-right">
                            ¥{Math.floor(item.unit_price * item.quantity).toLocaleString()}
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* 金額内訳 */}
                    <div className="border-t border-slate-200 pt-3 space-y-1.5">
                      {(() => {
                        const subtotal = (r.items ?? []).reduce((s, i) => s + i.unit_price * i.quantity, 0);
                        return (
                          <>
                            <div className="flex justify-between text-xs text-slate-500">
                              <span>商品合計（税込み）</span>
                              <span>¥{Math.floor(subtotal).toLocaleString()}</span>
                            </div>
                            {(r.charge_amount ?? 0) > 0 && (
                              <div className="flex justify-between text-xs text-slate-500">
                                <span>チャージ（{r.guest_count}名 × ¥{Math.floor(r.charge_per_person).toLocaleString()}）</span>
                                <span>¥{Math.floor(r.charge_amount).toLocaleString()}</span>
                              </div>
                            )}
                            {r.late_night_amount > 0 && (
                              <div className="flex justify-between text-xs text-amber-600">
                                <span>深夜料金（{Math.round((r.late_night_rate ?? 0) * 100)}%）</span>
                                <span>+¥{Math.floor(r.late_night_amount).toLocaleString()}</span>
                              </div>
                            )}
                            {r.discount_amount > 0 && (
                              <div className="flex justify-between text-xs">
                                <span className="text-red-500 font-medium">割引</span>
                                <span className="text-red-500 font-medium">−¥{Math.floor(r.discount_amount).toLocaleString()}</span>
                              </div>
                            )}
                            <div className="flex justify-between text-sm font-black text-slate-900 pt-1 border-t border-slate-200">
                              <span>合計（税込み）</span>
                              <span>¥{Math.floor(r.total_amount).toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between text-xs text-slate-400">
                              <span>内税（{Math.round((r.tax_rate ?? 0.10) * 100)}%）</span>
                              <span>¥{Math.floor(r.tax_amount ?? 0).toLocaleString()}</span>
                            </div>
                            {r.gift_cert_amount > 0 && (
                              <div className="flex justify-between text-xs text-emerald-700 pt-1 border-t border-slate-100">
                                <span>金券適用{r.gift_cert_no_change ? '（釣り無し）' : '（釣り有り）'}</span>
                                <span className="font-semibold">−¥{Math.floor(r.gift_cert_amount).toLocaleString()}</span>
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>

                    {/* メモ */}
                    {r.memo && (
                      <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                        <p className="text-[10px] font-semibold text-amber-600 uppercase tracking-widest mb-1">メモ</p>
                        <p className="text-xs text-amber-900 whitespace-pre-wrap">{r.memo}</p>
                      </div>
                    )}

                    <p className="text-xs text-slate-400 mt-3">
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
