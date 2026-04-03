import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';

const PAYMENT_METHODS = [
  { id: 'cash',   label: '現金',       icon: '💴' },
  { id: 'card',   label: 'カード',     icon: '💳' },
  { id: 'emoney', label: '電子マネー', icon: '📱' },
];

const QUICK_AMOUNTS = [1000, 5000, 10000];

// ── 電卓キーパッド ────────────────────────────────────────
const PAD_KEYS = [
  ['7','8','9','⌫'],
  ['4','5','6','C'],
  ['1','2','3', ''],
  ['000','0','00', ''],
];

function Numpad({ value, onChange }) {
  const handleKey = (key) => {
    if (key === '') return;
    if (key === 'C') { onChange(''); return; }
    if (key === '⌫') { onChange(value.slice(0, -1)); return; }
    // 先頭の0を除去、8桁上限
    const next = (value + key).replace(/^0+/, '') || '0';
    if (next.length > 8) return;
    onChange(next);
  };

  return (
    <div className="space-y-1.5">
      {PAD_KEYS.map((row, ri) => (
        <div key={ri} className="grid grid-cols-4 gap-1.5">
          {row.map((key, ki) => {
            if (key === '') return <div key={ki} />;
            const isAction = key === '⌫' || key === 'C';
            return (
              <button
                key={ki}
                type="button"
                onClick={() => handleKey(key)}
                className={`h-11 rounded-xl text-sm font-bold transition-all active:scale-95 ${
                  isAction
                    ? 'bg-gray-200 hover:bg-gray-300 text-gray-600'
                    : 'bg-white border border-gray-200 hover:bg-gray-50 hover:border-gray-300 text-gray-900 shadow-sm'
                }`}
              >
                {key}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ── メインコンポーネント ──────────────────────────────────
export default function PaymentModal({ order, table, onClose, onPaid }) {
  const queryClient = useQueryClient();
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [discountType,  setDiscountType]  = useState('amount'); // 'amount' | 'rate'
  const [discountInput, setDiscountInput] = useState('');
  const [receivedInput, setReceivedInput] = useState('');

  const { data: sysSettings } = useQuery({
    queryKey: ['system-settings'],
    queryFn: api.getSystemSettings,
    staleTime: 60_000,
  });
  const taxRate        = sysSettings?.tax_rate        ?? 0.10;
  const lnRate         = sysSettings?.late_night_rate  ?? 0.10;
  const lnStart        = sysSettings?.late_night_start ?? 22;
  const lnEnd          = sysSettings?.late_night_end   ?? 29;

  // 深夜帯判定（ブラウザのローカル時刻で判定）
  const isLateNight = (() => {
    const h = new Date().getHours();
    if (lnStart < 24 && lnEnd > 24) return h >= lnStart || h < (lnEnd - 24);
    if (lnStart >= 24) return h >= (lnStart - 24) && h < (lnEnd - 24);
    return h >= lnStart && h < lnEnd;
  })();

  const subtotal = order.items.reduce((s, i) => s + i.quantity * i.unit_price, 0);

  // 深夜料金
  const lateNightAmount = isLateNight ? Math.round(subtotal * lnRate) : 0;

  // 割引計算
  const discountNum = parseFloat(discountInput) || 0;
  const discountAmount = discountType === 'amount'
    ? Math.min(discountNum, subtotal)
    : Math.round(subtotal * Math.min(discountNum, 100) / 100);
  const taxableBase = subtotal + lateNightAmount - discountAmount;
  const taxAmount   = Math.round(taxableBase * taxRate);
  const finalTotal  = taxableBase + taxAmount;

  // お釣り計算 (現金のみ)
  const received = parseInt(receivedInput, 10) || 0;
  const change   = received - finalTotal;

  const payMutation = useMutation({
    mutationFn: () => api.pay(order.id, paymentMethod, discountAmount),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tables'] });
      queryClient.invalidateQueries({ queryKey: ['order', table.id] });
      onPaid();
    },
  });

  const isCash = paymentMethod === 'cash';
  const canPay = !payMutation.isPending && (isCash ? received >= finalTotal : true);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 fade-in p-4">
      <div className="bg-gray-50 rounded-2xl w-full max-w-lg shadow-2xl pop-in border border-gray-200 flex flex-col max-h-[95vh] overflow-hidden">

        {/* ── ヘッダー ── */}
        <div className="bg-white px-5 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-base font-bold text-gray-900">会計</h2>
            <p className="text-xs text-gray-400 mt-0.5">{table.name}</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="overflow-y-auto flex-1">
          <div className="p-5 space-y-4">

            {/* ── 注文明細 ── */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50">
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest">注文明細</p>
              </div>
              <div className="divide-y divide-gray-50 max-h-32 overflow-y-auto">
                {order.items.map((item) => (
                  <div key={item.id} className="flex justify-between text-sm px-4 py-2">
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
              <div className="flex justify-between px-4 py-2.5 border-t border-gray-100 bg-gray-50">
                <span className="text-xs font-medium text-gray-500">小計</span>
                <span className="text-sm font-bold text-gray-900">¥{subtotal.toLocaleString()}</span>
              </div>
            </div>

            {/* ── 割引 ── */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-3">割引</p>
              <div className="flex gap-2 items-center">
                {/* トグル */}
                <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-semibold flex-shrink-0">
                  <button
                    onClick={() => { setDiscountType('amount'); setDiscountInput(''); }}
                    className={`px-3 py-2 transition-colors ${
                      discountType === 'amount' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    値引額
                  </button>
                  <button
                    onClick={() => { setDiscountType('rate'); setDiscountInput(''); }}
                    className={`px-3 py-2 transition-colors ${
                      discountType === 'rate' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    割引率
                  </button>
                </div>
                {/* 入力 */}
                <div className="flex items-center flex-1 border border-gray-200 rounded-lg overflow-hidden bg-gray-50 focus-within:ring-2 focus-within:ring-blue-400 focus-within:border-transparent">
                  <span className="pl-3 text-gray-400 text-sm flex-shrink-0">
                    {discountType === 'amount' ? '¥' : ''}
                  </span>
                  <input
                    type="number"
                    min="0"
                    max={discountType === 'rate' ? 100 : subtotal}
                    value={discountInput}
                    onChange={(e) => setDiscountInput(e.target.value)}
                    placeholder="0"
                    className="flex-1 px-2 py-2 text-sm bg-transparent outline-none text-gray-900 text-right"
                  />
                  <span className="pr-3 text-gray-400 text-sm flex-shrink-0">
                    {discountType === 'rate' ? '%' : ''}
                  </span>
                </div>
                {/* 割引額プレビュー */}
                {discountAmount > 0 && (
                  <span className="text-sm font-bold text-red-500 flex-shrink-0">
                    −¥{discountAmount.toLocaleString()}
                  </span>
                )}
              </div>
            </div>

            {/* ── 合計 ── */}
            <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 space-y-2">
              <div className="flex justify-between text-sm text-gray-500">
                <span>小計（税抜き）</span>
                <span>¥{subtotal.toLocaleString()}</span>
              </div>
              {isLateNight && (
                <div className="flex justify-between text-sm text-amber-600">
                  <span>深夜料金（{Math.round(lnRate * 100)}%）</span>
                  <span>¥{lateNightAmount.toLocaleString()}</span>
                </div>
              )}
              {discountAmount > 0 && (
                <div className="flex justify-between text-sm text-gray-500">
                  <span>割引</span>
                  <span className="text-red-500 font-semibold">−¥{discountAmount.toLocaleString()}</span>
                </div>
              )}
              <div className="flex justify-between text-sm text-gray-500">
                <span>消費税（{Math.round(taxRate * 100)}%）</span>
                <span>¥{taxAmount.toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center pt-2 border-t border-gray-100">
                <span className="text-sm font-semibold text-gray-700">請求金額（税込み）</span>
                <span className="text-2xl font-black text-gray-900">¥{finalTotal.toLocaleString()}</span>
              </div>
            </div>

            {/* ── 支払い方法 ── */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-3">支払い方法</p>
              <div className="grid grid-cols-3 gap-2">
                {PAYMENT_METHODS.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setPaymentMethod(m.id)}
                    className={`flex flex-col items-center gap-1 py-2.5 rounded-xl border-2 transition-all ${
                      paymentMethod === m.id
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                        : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <span className="text-lg">{m.icon}</span>
                    <span className="text-xs font-semibold">{m.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* ── 受取金額 (現金のみ) ── */}
            {isCash && (
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-3">受取金額</p>

                {/* ディスプレイ */}
                <div className="bg-gray-900 rounded-xl px-4 py-3 mb-3 text-right">
                  <p className="text-2xl font-black text-white tracking-wider">
                    ¥{receivedInput ? parseInt(receivedInput, 10).toLocaleString() : '0'}
                  </p>
                </div>

                {/* クイック金額ボタン */}
                <div className="grid grid-cols-3 gap-1.5 mb-3">
                  {QUICK_AMOUNTS.map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => setReceivedInput(String(amt))}
                      className={`py-2 rounded-xl text-xs font-bold border transition-all active:scale-95 ${
                        received === amt
                          ? 'bg-indigo-600 border-indigo-600 text-white'
                          : 'bg-white border-gray-200 text-gray-700 hover:border-indigo-400 hover:text-indigo-600'
                      }`}
                    >
                      ¥{amt.toLocaleString()}
                    </button>
                  ))}
                </div>

                {/* キーパッド */}
                <Numpad value={receivedInput} onChange={setReceivedInput} />

                {/* お釣り表示 */}
                <div className={`mt-3 rounded-xl px-4 py-3 flex justify-between items-center ${
                  change >= 0 ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'
                }`}>
                  <span className={`text-sm font-semibold ${change >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                    {change >= 0 ? 'お釣り' : '不足金額'}
                  </span>
                  <span className={`text-2xl font-black ${change >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                    ¥{Math.abs(change).toLocaleString()}
                  </span>
                </div>
              </div>
            )}

          </div>
        </div>

        {/* ── フッター ── */}
        <div className="bg-white px-5 py-4 border-t border-gray-200 flex gap-3 flex-shrink-0">
          <button
            onClick={onClose}
            className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-medium transition-colors text-sm"
          >
            キャンセル
          </button>
          <button
            onClick={() => payMutation.mutate()}
            disabled={!canPay}
            className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white rounded-xl font-bold transition-colors text-sm shadow-sm"
          >
            {payMutation.isPending ? '処理中...' : '支払い完了'}
          </button>
        </div>

      </div>
    </div>
  );
}
