import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import PaymentModal from '../components/pos/PaymentModal';

const inp = 'w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 caret-primary-500 transition-colors';
const lbl = 'block text-xs font-semibold text-slate-500 mb-1.5';

const PAYMENT_LABEL = { cash: '現金', card: 'カード', emoney: '電子マネー' };

function getReceiptLabel(r) {
  if (r.receipt_type === 'black_cancelled') return { label: '黒伝票取消し', badgeCls: 'bg-gray-100 text-gray-500' };
  if (r.receipt_type === 'void')            return { label: '会計取消し',   badgeCls: 'bg-orange-100 text-orange-600' };
  if (r.receipt_type === 'red') {
    return r.status === 'paid'
      ? { label: '黒伝票会計済み', badgeCls: 'bg-emerald-100 text-emerald-700' }
      : { label: '赤伝票',         badgeCls: 'bg-red-100 text-red-600' };
  }
  return null;
}

function fmt(iso) {
  if (!iso) return '--:--';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function VoidAndReissueButton({ orderId, onSuccess }) {
  const [showConfirm, setShowConfirm] = useState(false);
  const mutation = useMutation({
    mutationFn: () => api.voidAndReissue(orderId),
    onSuccess: () => { setShowConfirm(false); onSuccess(); },
  });

  if (showConfirm) {
    return (
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-100">
        <span className="text-xs text-slate-500 flex-1">この伝票を取り消して赤伝票を発行しますか？</span>
        <button
          onClick={() => setShowConfirm(false)}
          className="text-xs px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200"
        >
          キャンセル
        </button>
        <button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          className="text-xs px-3 py-1.5 rounded-lg bg-red-600 text-white font-bold hover:bg-red-700 disabled:opacity-50"
        >
          {mutation.isPending ? '処理中...' : '発行確定'}
        </button>
        {mutation.isError && (
          <span className="text-xs text-red-500 ml-1">{mutation.error?.message}</span>
        )}
      </div>
    );
  }

  return (
    <div className="mt-3 pt-3 border-t border-slate-100">
      <button
        onClick={() => setShowConfirm(true)}
        className="text-xs px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors"
      >
        赤伝票を発行
      </button>
    </div>
  );
}

function RedReceiptPayButton({ receipt, onPaid }) {
  const [showPayment, setShowPayment] = useState(false);

  const { data: fullOrder, isFetching } = useQuery({
    queryKey: ['order-for-payment', receipt.id],
    queryFn: () => api.getOrder(receipt.id),
    enabled: showPayment,
    staleTime: 0,
  });

  const table = { id: receipt.table_id, name: receipt.table_name };

  return (
    <>
      <div className="mt-3 pt-3 border-t border-slate-100">
        <button
          onClick={() => setShowPayment(true)}
          disabled={isFetching}
          className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-bold hover:bg-emerald-700 disabled:opacity-50 transition-colors"
        >
          {isFetching ? '読み込み中...' : '会計する'}
        </button>
      </div>
      {showPayment && fullOrder && (
        <PaymentModal
          order={fullOrder}
          table={table}
          onClose={() => setShowPayment(false)}
          onPaid={() => { setShowPayment(false); onPaid(); }}
        />
      )}
    </>
  );
}

export default function ReceiptsPage() {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  const [date, setDate] = useState(today);
  const [expandedId, setExpandedId] = useState(null);
  const queryClient = useQueryClient();

  const { data: receipts = [], isLoading } = useQuery({
    queryKey: ['receipts', date],
    queryFn: () => api.getReceipts(date),
  });

  const onReceiptsChange = () => {
    queryClient.invalidateQueries({ queryKey: ['receipts', date] });
    queryClient.invalidateQueries({ queryKey: ['tables'] });
  };

  const effectiveReceipts = receipts.filter(
    r => r.status === 'paid'
      && r.receipt_type !== 'void'
      && r.receipt_type !== 'black_cancelled'
  );
  const totalRevenue  = effectiveReceipts.reduce((s, r) => s + r.total_amount, 0);
  const totalDiscount = effectiveReceipts.reduce((s, r) => s + (r.discount_amount ?? 0), 0);
  const totalGiftCert = effectiveReceipts.reduce((s, r) => s + (r.gift_cert_amount ?? 0), 0);

  return (
    <div className="px-8 py-12 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900">伝票情報</h1>
        <p className="text-base text-body leading-relaxed mt-2">会計済み伝票を日付別に確認できます</p>
      </div>
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
          {effectiveReceipts.length > 0 && (
            <span className="ml-auto text-sm text-slate-500">
              <span className="font-bold text-slate-800">{effectiveReceipts.length}</span> 件
            </span>
          )}
        </div>

        {effectiveReceipts.length > 0 && (
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
            const isOpen       = expandedId === r.id;
            const typeConfig   = getReceiptLabel(r);
            const hasDiscount  = (r.discount_amount ?? 0) > 0;
            const hasGiftCert  = (r.gift_cert_amount ?? 0) > 0;
            const hasMemo      = !!r.memo;
            const isCancelled  = r.receipt_type === 'black_cancelled' || r.receipt_type === 'void';
            const isRedOpen    = r.receipt_type === 'red' && r.status === 'open';
            const canVoid      = ['normal', 'red'].includes(r.receipt_type) && r.status === 'paid' && date === today;
            const displayTime  = fmt(r.closed_at ?? r.opened_at);

            return (
              <div
                key={r.id}
                className={`bg-white border rounded-xl shadow-sm overflow-hidden ${
                  isCancelled ? 'border-slate-100 opacity-70' : 'border-slate-200'
                }`}
              >
                <button
                  onClick={() => setExpandedId(isOpen ? null : r.id)}
                  className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-slate-50 transition-colors"
                >
                  <span className="text-xs text-slate-400 font-mono w-10 flex-shrink-0">{displayTime}</span>
                  <span className={`text-sm font-semibold flex-1 ${isCancelled ? 'text-slate-400 line-through' : 'text-slate-900'}`}>
                    {r.table_name}
                  </span>

                  <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end">
                    {typeConfig && (
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${typeConfig.badgeCls}`}>
                        {typeConfig.label}
                      </span>
                    )}
                    {hasDiscount && !isCancelled && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-600">割引</span>
                    )}
                    {hasGiftCert && !isCancelled && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700">金券</span>
                    )}
                    {hasMemo && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700">メモ</span>
                    )}
                    {!isRedOpen && (
                      <span className="text-xs px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 font-medium">
                        {PAYMENT_LABEL[r.payment_method] ?? r.payment_method}
                      </span>
                    )}
                  </div>

                  <span className={`text-sm font-bold w-24 text-right flex-shrink-0 ${isCancelled ? 'text-slate-400' : 'text-slate-900'}`}>
                    {isRedOpen ? '未会計' : `¥${Math.floor(r.total_amount).toLocaleString()}`}
                  </span>
                  <span className={`text-xs text-slate-400 transition-transform flex-shrink-0 ${isOpen ? 'rotate-90' : ''}`}>▶</span>
                </button>

                {isOpen && (
                  <div className="bg-slate-50 border-t border-slate-100 px-6 py-4">
                    {r.original_order_id && (
                      <p className="text-xs text-slate-400 mb-3">元伝票 #{r.original_order_id}</p>
                    )}

                    {(r.items ?? []).filter(i => i.item_name != null).length > 0 && (
                      <div className="space-y-2.5 mb-4">
                        {(r.items ?? []).filter(i => i.item_name != null).map((item, idx) => (
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
                    )}

                    {!isCancelled && !isRedOpen && (
                      <div className="border-t border-slate-200 pt-3 space-y-1.5">
                        {(() => {
                          const subtotal = (r.items ?? [])
                            .filter(i => i.item_name != null)
                            .reduce((s, i) => s + i.unit_price * i.quantity, 0);
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
                    )}

                    {r.memo && (
                      <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                        <p className="text-[10px] font-semibold text-amber-600 uppercase tracking-widest mb-1">メモ</p>
                        <p className="text-xs text-amber-900 whitespace-pre-wrap">{r.memo}</p>
                      </div>
                    )}

                    <p className="text-xs text-slate-400 mt-3">
                      伝票 #{r.id}
                      {r.closed_at && (
                        <> &nbsp;·&nbsp; {new Date(r.closed_at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</>
                      )}
                      {!r.closed_at && r.opened_at && (
                        <> &nbsp;·&nbsp; 発行 {new Date(r.opened_at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</>
                      )}
                    </p>

                    {canVoid && (
                      <VoidAndReissueButton orderId={r.id} onSuccess={onReceiptsChange} />
                    )}

                    {isRedOpen && (
                      <RedReceiptPayButton receipt={r} onPaid={onReceiptsChange} />
                    )}
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
