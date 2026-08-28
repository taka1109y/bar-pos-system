import { useState } from 'react';

// 人数選択UI。0名(飲み直し等=チャージなし)・1〜10のボタンに加え「その他(手入力)」で任意人数(0〜99)を指定できる。
// スタッフ用の人数変更モーダル・初期人数選択で共用する。
export default function GuestCountPicker({ currentCount, onSelect, disabled }) {
  const [manual, setManual] = useState(false);
  const [value, setValue] = useState('');

  const submitManual = () => {
    const n = Math.min(99, Math.max(0, parseInt(value, 10) || 0));
    if (n >= 0) onSelect(n);
  };

  if (manual) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <input
            type="number" min="0" max="99" autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submitManual(); }}
            placeholder="人数を入力"
            className="w-full bg-surface border border-line-strong rounded-lg px-3 py-2 text-heading text-base focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 caret-primary-500"
          />
          <span className="text-sm text-muted flex-shrink-0">名</span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { setManual(false); setValue(''); }}
            className="flex-1 py-2.5 bg-surface-sunken hover:bg-surface-hover text-body text-sm font-medium rounded-lg transition-colors"
          >
            戻る
          </button>
          <button
            onClick={submitManual}
            disabled={disabled || !value}
            className="flex-1 py-2.5 bg-primary-500 hover:bg-primary-700 text-white text-sm font-bold rounded-lg transition-colors disabled:opacity-50"
          >
            確定
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* 0名（飲み直し等・チャージなし）。1名以上と区別して明示する */}
      <button
        onClick={() => onSelect(0)}
        disabled={disabled}
        className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border transition-all active:scale-95 disabled:opacity-50 ${
          currentCount === 0
            ? 'bg-primary-50 border-primary-300 text-primary-700'
            : 'bg-surface-sunken border-line hover:bg-primary-50 hover:border-primary-300'
        }`}
      >
        <span className="text-base font-black text-heading">0名</span>
        <span className="text-[11px] text-faint">チャージなし（飲み直し等）</span>
      </button>
      <div className="grid grid-cols-5 gap-2">
      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          onClick={() => onSelect(n)}
          disabled={disabled}
          className={`aspect-square flex flex-col items-center justify-center rounded-xl border transition-all active:scale-95 disabled:opacity-50 ${
            n === currentCount
              ? 'bg-primary-50 border-primary-300 text-primary-700'
              : 'bg-surface-sunken border-line hover:bg-primary-50 hover:border-primary-300'
          }`}
        >
          <span className="text-lg font-black text-heading">{n}</span>
          <span className="text-[10px] text-faint">名</span>
        </button>
      ))}
      <button
        onClick={() => setManual(true)}
        disabled={disabled}
        className="aspect-square flex flex-col items-center justify-center rounded-xl border border-dashed border-line-strong bg-surface hover:bg-primary-50 hover:border-primary-300 transition-all active:scale-95 disabled:opacity-50"
      >
        <span className="text-sm font-bold text-body">その他</span>
        <span className="text-[10px] text-faint">手入力</span>
      </button>
      </div>
    </div>
  );
}
