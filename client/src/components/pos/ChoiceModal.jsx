import { useState } from 'react';
import { yen } from '../../utils/format';

// 注文時の質問モーダル。
// allowMultiple=true: 複数選択（トグル＋「決定」ボタン）。false: 単一選択（タップ即確定）。
// 確定時に onConfirm(選択した choice の配列) を呼ぶ。
export default function ChoiceModal({ title, choices, allowMultiple = false, onConfirm, onClose }) {
  const [selected, setSelected] = useState([]);
  const toggle = (label) =>
    setSelected((prev) => (prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]));
  const confirmMulti = () => {
    const chosen = choices.filter((c) => selected.includes(c.label));
    if (chosen.length > 0) onConfirm(chosen);
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 fade-in">
      <div className="bg-white rounded-xl p-5 w-80 shadow-xl pop-in border border-slate-200">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-slate-900">{title}</h3>
          <button onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        {allowMultiple && <p className="text-xs text-slate-400 mb-2">複数選択できます</p>}
        <div className="space-y-2">
          {choices.map((choice) => {
            const isSel = selected.includes(choice.label);
            return (
              <button
                key={choice.label}
                onClick={() => (allowMultiple ? toggle(choice.label) : onConfirm([choice]))}
                className={`w-full text-left px-4 py-3 rounded-xl border text-sm font-medium transition-all active:scale-[0.98] flex items-center justify-between ${
                  isSel
                    ? 'bg-primary-50 border-primary-300 text-primary-700'
                    : 'bg-slate-50 border-slate-200 hover:bg-primary-50 hover:border-primary-300 text-slate-800'
                }`}
              >
                <span>
                  {choice.label}
                  {choice.priceDelta > 0 && (
                    <span className="ml-2 text-xs font-semibold text-primary-600">+¥{yen(choice.priceDelta)}</span>
                  )}
                </span>
                {allowMultiple && (
                  <span className={`w-5 h-5 flex items-center justify-center rounded border flex-shrink-0 ${
                    isSel ? 'bg-primary-500 border-primary-500 text-white' : 'border-slate-300'
                  }`}>
                    {isSel && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    )}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {allowMultiple && (
          <button
            onClick={confirmMulti}
            disabled={selected.length === 0}
            className="w-full mt-4 py-3 bg-primary-500 hover:bg-primary-700 text-white text-sm font-bold rounded-xl transition-colors disabled:opacity-50"
          >
            決定{selected.length > 0 ? `（${selected.length}件）` : ''}
          </button>
        )}
      </div>
    </div>
  );
}
