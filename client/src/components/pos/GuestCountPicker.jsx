import { useState } from 'react';

// 人数選択UI。1〜10のボタンに加え「その他(手入力)」で任意人数(1〜99)を指定できる。
// スタッフ用の人数変更モーダル・初期人数選択で共用する。
export default function GuestCountPicker({ currentCount, onSelect, disabled }) {
  const [manual, setManual] = useState(false);
  const [value, setValue] = useState('');

  const submitManual = () => {
    const n = Math.min(99, Math.max(1, parseInt(value, 10) || 0));
    if (n >= 1) onSelect(n);
  };

  if (manual) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <input
            type="number" min="1" max="99" autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submitManual(); }}
            placeholder="人数を入力"
            className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-900 text-base focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 caret-primary-500"
          />
          <span className="text-sm text-slate-500 flex-shrink-0">名</span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { setManual(false); setValue(''); }}
            className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-sm font-medium rounded-lg transition-colors"
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
    <div className="grid grid-cols-5 gap-2">
      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          onClick={() => onSelect(n)}
          disabled={disabled}
          className={`aspect-square flex flex-col items-center justify-center rounded-xl border transition-all active:scale-95 disabled:opacity-50 ${
            n === currentCount
              ? 'bg-primary-50 border-primary-300 text-primary-700'
              : 'bg-slate-50 border-slate-200 hover:bg-primary-50 hover:border-primary-300'
          }`}
        >
          <span className="text-lg font-black text-slate-900">{n}</span>
          <span className="text-[10px] text-slate-400">名</span>
        </button>
      ))}
      <button
        onClick={() => setManual(true)}
        disabled={disabled}
        className="aspect-square flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white hover:bg-primary-50 hover:border-primary-300 transition-all active:scale-95 disabled:opacity-50"
      >
        <span className="text-sm font-bold text-slate-600">その他</span>
        <span className="text-[10px] text-slate-400">手入力</span>
      </button>
    </div>
  );
}
