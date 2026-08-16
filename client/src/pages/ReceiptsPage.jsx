import { useState } from 'react';
import { yen } from '../utils/format';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import PaymentModal from '../components/pos/PaymentModal';
import { exportReceiptsPdf } from '../utils/receiptsPdfExport';
import { TZ } from '../utils/tz';
import { Button, Field, Input, Badge, Toolbar, cn } from '../components/ui';

const PAYMENT_LABEL = { cash: '現金', card: 'カード', emoney: '電子マネー', split: '分割' };

function paymentMethodText(r) {
  if (r.payment_method === 'split') {
    const parts = ['cash', 'card', 'emoney']
      .filter((k) => (r[`${k}_amount`] ?? 0) > 0)
      .map((k) => `${PAYMENT_LABEL[k]}¥${yen(Math.floor(r[`${k}_amount`]))}`);
    return `分割 ${parts.join(' / ')}`;
  }
  return PAYMENT_LABEL[r.payment_method] ?? r.payment_method;
}

// 伝票種別 → バッジ表現(tone)
function getReceiptLabel(r) {
  if (r.receipt_type === 'black_cancelled') return { label: '黒伝票取消し', tone: 'neutral' };
  if (r.receipt_type === 'void')            return { label: '会計取消し',   tone: 'warning' };
  if (r.receipt_type === 'red') {
    return r.status === 'paid'
      ? { label: '黒伝票会計済み', tone: 'success' }
      : { label: '赤伝票',         tone: 'danger' };
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
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-line flex-wrap">
        <span className="text-xs text-muted flex-1">この伝票を取り消して赤伝票を発行しますか？</span>
        <Button variant="secondary" size="sm" onClick={() => setShowConfirm(false)}>キャンセル</Button>
        <Button variant="danger" size="sm" loading={mutation.isPending} onClick={() => mutation.mutate()}>発行確定</Button>
        {mutation.isError && <span className="text-xs text-danger ml-1">{mutation.error?.message}</span>}
      </div>
    );
  }
  return (
    <div className="mt-3 pt-3 border-t border-line">
      <Button variant="secondary" size="sm" className="text-danger border-red-200 hover:bg-red-50" onClick={() => setShowConfirm(true)}>赤伝票を発行</Button>
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
      <div className="mt-3 pt-3 border-t border-line">
        <Button variant="success" size="sm" loading={isFetching} onClick={() => setShowPayment(true)}>会計する</Button>
      </div>
      {showPayment && fullOrder && (
        <PaymentModal order={fullOrder} table={table} onClose={() => setShowPayment(false)} onPaid={() => { setShowPayment(false); onPaid(); }} />
      )}
    </>
  );
}

export default function ReceiptsPage() {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
  const [date, setDate] = useState(today);
  const [expandedId, setExpandedId] = useState(null);
  const [pdfGenerating, setPdfGenerating] = useState(false);
  const queryClient = useQueryClient();

  const { data: receipts = [], isLoading } = useQuery({
    queryKey: ['receipts', date],
    queryFn: () => api.getReceipts(date),
  });

  const handlePdfExport = async () => {
    if (pdfGenerating) return;
    setPdfGenerating(true);
    try {
      await exportReceiptsPdf(receipts, date);
    } catch (err) {
      console.error('PDF出力失敗:', err);
    } finally {
      setPdfGenerating(false);
    }
  };

  const onReceiptsChange = () => {
    queryClient.invalidateQueries({ queryKey: ['receipts', date] });
    queryClient.invalidateQueries({ queryKey: ['tables'] });
  };

  const effectiveReceipts = receipts.filter(
    r => r.status === 'paid' && r.receipt_type !== 'void' && r.receipt_type !== 'black_cancelled'
  );
  const totalRevenue  = effectiveReceipts.reduce((s, r) => s + r.total_amount, 0);
  const totalDiscount = effectiveReceipts.reduce((s, r) => s + (r.discount_amount ?? 0), 0);
  const totalGiftCert = effectiveReceipts.reduce((s, r) => s + (r.gift_cert_amount ?? 0), 0);

  return (
    <div className="ui-pad p-4 md:p-6 space-y-4">
      <Toolbar title="伝票情報" subtitle="会計済み伝票を日付別に確認">
        <div className="flex items-end gap-3">
          <Field label="日付"><Input type="date" value={date} onChange={(e) => { setDate(e.target.value); setExpandedId(null); }} /></Field>
          {receipts.length > 0 && (
            <>
              <span className="text-sm text-muted pb-2"><span className="font-bold text-heading">{effectiveReceipts.length}</span> 件</span>
              <Button variant="secondary" loading={pdfGenerating} onClick={handlePdfExport}>PDF出力</Button>
            </>
          )}
        </div>
      </Toolbar>

      {effectiveReceipts.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-surface border border-line rounded-xl px-4 py-3 shadow-sm">
            <p className="text-2xs font-semibold text-muted uppercase tracking-wider mb-1">総売上</p>
            <p className="text-lg font-bold text-heading tabular-nums">¥{yen(Math.floor(totalRevenue))}</p>
          </div>
          <div className={cn('border rounded-xl px-4 py-3 shadow-sm', totalDiscount > 0 ? 'bg-red-50 border-red-200' : 'bg-surface border-line')}>
            <p className="text-2xs font-semibold text-muted uppercase tracking-wider mb-1">割引合計</p>
            <p className={cn('text-lg font-bold tabular-nums', totalDiscount > 0 ? 'text-red-500' : 'text-faint')}>{totalDiscount > 0 ? `−¥${yen(Math.floor(totalDiscount))}` : '¥0'}</p>
          </div>
          <div className={cn('border rounded-xl px-4 py-3 shadow-sm', totalGiftCert > 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-surface border-line')}>
            <p className="text-2xs font-semibold text-muted uppercase tracking-wider mb-1">金券合計</p>
            <p className={cn('text-lg font-bold tabular-nums', totalGiftCert > 0 ? 'text-emerald-600' : 'text-faint')}>{totalGiftCert > 0 ? `¥${yen(Math.floor(totalGiftCert))}` : '¥0'}</p>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center h-40 text-muted text-sm">読み込み中...</div>
      ) : receipts.length === 0 ? (
        <div className="bg-surface border border-line rounded-xl p-12 text-center shadow-sm">
          <p className="text-muted text-sm">この日の伝票はありません</p>
        </div>
      ) : (
        <div className="space-y-2">
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
              <div key={r.id} className={cn('bg-surface border rounded-xl shadow-sm overflow-hidden', isCancelled ? 'border-line opacity-70' : 'border-line')}>
                <button onClick={() => setExpandedId(isOpen ? null : r.id)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-hover transition-colors cursor-pointer" aria-expanded={isOpen}>
                  <span className="text-xs text-muted font-mono w-10 flex-shrink-0">{displayTime}</span>
                  <span className={cn('text-sm font-semibold flex-1', isCancelled ? 'text-faint line-through' : 'text-heading')}>{r.table_name}</span>

                  <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end">
                    {typeConfig && <Badge tone={typeConfig.tone} size="sm">{typeConfig.label}</Badge>}
                    {hasDiscount && !isCancelled && <Badge tone="danger" size="sm">割引</Badge>}
                    {hasGiftCert && !isCancelled && <Badge tone="success" size="sm">金券</Badge>}
                    {hasMemo && <Badge tone="warning" size="sm">メモ</Badge>}
                    {!isRedOpen && <Badge tone="neutral">{paymentMethodText(r)}</Badge>}
                  </div>

                  <span className={cn('text-sm font-bold w-24 text-right flex-shrink-0 tabular-nums', isCancelled ? 'text-faint' : 'text-heading')}>
                    {isRedOpen ? '未会計' : `¥${yen(Math.floor(r.total_amount))}`}
                  </span>
                  <span className={cn('text-xs text-faint transition-transform flex-shrink-0', isOpen && 'rotate-90')}>▶</span>
                </button>

                {isOpen && (
                  <div className="bg-surface-sunken border-t border-line px-5 py-4">
                    {r.original_order_id && <p className="text-xs text-muted mb-3">元伝票 #{r.original_order_id}</p>}

                    {(r.items ?? []).filter(i => i.item_name != null).length > 0 && (
                      <div className="space-y-2 mb-4">
                        {(r.items ?? []).filter(i => i.item_name != null).map((item, idx) => (
                          <div key={idx} className="flex items-center gap-3 text-sm">
                            <span className="flex-1 text-body">{item.item_name}</span>
                            <span className="text-muted text-xs w-20 text-right">¥{yen(Math.floor(item.unit_price))} × {item.quantity}</span>
                            <span className="font-semibold text-heading w-20 text-right">¥{yen(Math.floor(item.unit_price * item.quantity))}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {!isCancelled && !isRedOpen && (
                      <div className="border-t border-line pt-3 space-y-1.5">
                        {(() => {
                          const subtotal = (r.items ?? []).filter(i => i.item_name != null).reduce((s, i) => s + i.unit_price * i.quantity, 0);
                          return (
                            <>
                              <div className="flex justify-between text-xs text-muted"><span>商品合計（税込み）</span><span>¥{yen(Math.floor(subtotal))}</span></div>
                              {(r.charge_amount ?? 0) > 0 && (
                                <div className="flex justify-between text-xs text-muted"><span>チャージ（{r.guest_count}名 × ¥{yen(Math.floor(r.charge_per_person))}）</span><span>¥{yen(Math.floor(r.charge_amount))}</span></div>
                              )}
                              {r.late_night_amount > 0 && (
                                <div className="flex justify-between text-xs text-amber-600"><span>深夜料金（{Math.round((r.late_night_rate ?? 0) * 100)}%）</span><span>+¥{yen(Math.floor(r.late_night_amount))}</span></div>
                              )}
                              {r.discount_amount > 0 && (
                                <div className="flex justify-between text-xs"><span className="text-red-500 font-medium">割引</span><span className="text-red-500 font-medium">−¥{yen(Math.floor(r.discount_amount))}</span></div>
                              )}
                              <div className="flex justify-between text-sm font-bold text-heading pt-1 border-t border-line"><span>合計（税込み）</span><span>¥{yen(Math.floor(r.total_amount))}</span></div>
                              <div className="flex justify-between text-xs text-faint"><span>内税（{Math.round((r.tax_rate ?? 0.10) * 100)}%）</span><span>¥{yen(Math.floor(r.tax_amount ?? 0))}</span></div>
                              {r.gift_cert_amount > 0 && (
                                <div className="flex justify-between text-xs text-emerald-700 pt-1 border-t border-line"><span>金券適用{r.gift_cert_no_change ? '（釣り無し）' : '（釣り有り）'}</span><span className="font-semibold">−¥{yen(Math.floor(r.gift_cert_amount))}</span></div>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    )}

                    {r.memo && (
                      <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                        <p className="text-2xs font-semibold text-amber-600 uppercase tracking-widest mb-1">メモ</p>
                        <p className="text-xs text-amber-900 whitespace-pre-wrap">{r.memo}</p>
                      </div>
                    )}

                    <p className="text-xs text-faint mt-3">
                      伝票 #{r.id}
                      {r.closed_at && <> &nbsp;·&nbsp; {new Date(r.closed_at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</>}
                      {!r.closed_at && r.opened_at && <> &nbsp;·&nbsp; 発行 {new Date(r.opened_at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</>}
                    </p>

                    {canVoid && <VoidAndReissueButton orderId={r.id} onSuccess={onReceiptsChange} />}
                    {isRedOpen && <RedReceiptPayButton receipt={r} onPaid={onReceiptsChange} />}
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
