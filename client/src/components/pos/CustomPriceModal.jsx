import { useState } from 'react';

// 時価（price_editable）商品の価格・商品名を入力するモーダル。
// OrderPanel と ImmediateCheckoutPanel の両方で使う共有コンポーネント。
export default function CustomPriceModal({ defaultName, defaultPrice, onConfirm, onClose, isPending }) {
  const [name, setName]   = useState(defaultName ?? '');
  const [price, setPrice] = useState(String(defaultPrice ?? ''));

  const MAX_PRICE  = 1_000_000; // 時価の上限(桁溢れ・誤入力防止)
  const priceNum   = Number(price);
  const nameValid  = name.trim().length > 0 && name.trim().length <= 100;
  const priceValid = price !== '' && Number.isFinite(priceNum) && priceNum >= 0 && priceNum <= MAX_PRICE;
  const canSubmit  = nameValid && priceValid && !isPending;

  const submit = () => {
    if (!canSubmit) return;
    onConfirm(name.trim(), Math.round(priceNum));
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 fade-in">
      <div className="bg-surface rounded-xl p-5 w-80 shadow-xl pop-in border border-line">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-heading">価格・商品名を入力</h3>
          <button onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-faint hover:bg-surface-sunken transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-muted mb-1.5">商品名</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              placeholder="例: 本マグロ中トロ"
              className="w-full bg-surface border border-line-strong rounded-lg px-3 py-2.5 text-heading text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 caret-primary-500 transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1.5">価格（税込）</label>
            <div className="flex items-center bg-surface border border-line-strong rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-primary-500/50 focus-within:border-primary-500">
              <span className="pl-3 pr-1 text-faint text-sm">¥</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
                placeholder="0"
                className="flex-1 bg-transparent px-2 py-2.5 text-heading text-sm focus:outline-none caret-primary-500"
              />
            </div>
          </div>
        </div>

        <div className="flex gap-2.5 mt-5">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 bg-surface-sunken hover:bg-surface-hover text-body text-sm font-medium rounded-lg transition-colors"
          >
            キャンセル
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="flex-1 py-2.5 bg-primary-500 hover:bg-primary-700 text-white text-sm font-bold rounded-xl transition-colors disabled:opacity-50"
          >
            追加する
          </button>
        </div>
      </div>
    </div>
  );
}
