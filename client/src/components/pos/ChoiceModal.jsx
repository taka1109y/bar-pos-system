import { useState } from 'react';
import { yen } from '../../utils/format';

// 注文時の質問モーダル。
// allowQuantity=true: 数量指定（選択肢ごとに個数ステッパー＋「決定」）。最優先。
// allowMultiple=true: 複数選択（トグル＋「決定」）。
// どちらも false: 単一選択（タップ即確定）。
// 確定時に onConfirm([{ label, priceDelta, count }]) を呼ぶ（単一/複数は count=1）。
export default function ChoiceModal({ title, choices, allowMultiple = false, allowQuantity = false, onConfirm, onClose }) {
  const [selected, setSelected] = useState([]);   // 複数選択用ラベル配列
  const [counts, setCounts] = useState({});        // 数量指定用 { label: count }

  const toggle = (label) =>
    setSelected((prev) => (prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]));

  const setCount = (label, delta) =>
    setCounts((prev) => ({ ...prev, [label]: Math.max(0, Math.min(99, (prev[label] || 0) + delta)) }));

  const totalCount = choices.reduce((s, c) => s + (counts[c.label] || 0), 0);

  const confirmMulti = () => {
    const chosen = choices.filter((c) => selected.includes(c.label)).map((c) => ({ ...c, count: 1 }));
    if (chosen.length > 0) onConfirm(chosen);
  };
  const confirmQuantity = () => {
    const chosen = choices.filter((c) => (counts[c.label] || 0) > 0).map((c) => ({ ...c, count: counts[c.label] }));
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
        {allowQuantity ? (
          <p className="text-xs text-slate-400 mb-2">個数を指定できます</p>
        ) : allowMultiple ? (
          <p className="text-xs text-slate-400 mb-2">複数選択できます</p>
        ) : null}
        <div className="space-y-2">
          {choices.map((choice) => {
            if (allowQuantity) {
              const cnt = counts[choice.label] || 0;
              return (
                <div
                  key={choice.label}
                  className={`w-full px-4 py-3 rounded-xl border text-sm font-medium flex items-center justify-between ${
                    cnt > 0 ? 'bg-primary-50 border-primary-300' : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <span className="text-slate-800">
                    {choice.label}
                    {choice.priceDelta > 0 && (
                      <span className="ml-2 text-xs font-semibold text-primary-600">+¥{yen(choice.priceDelta)}</span>
                    )}
                  </span>
                  <span className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => setCount(choice.label, -1)}
                      disabled={cnt === 0}
                      aria-label={`${choice.label}を減らす`}
                      className="w-7 h-7 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-base font-bold flex items-center justify-center disabled:opacity-40"
                    >
                      −
                    </button>
                    <span className="w-6 text-center text-sm font-bold text-slate-900">{cnt}</span>
                    <button
                      onClick={() => setCount(choice.label, 1)}
                      aria-label={`${choice.label}を増やす`}
                      className="w-7 h-7 rounded-lg bg-primary-500 hover:bg-primary-700 text-white text-base font-bold flex items-center justify-center"
                    >
                      +
                    </button>
                  </span>
                </div>
              );
            }
            const isSel = selected.includes(choice.label);
            return (
              <button
                key={choice.label}
                onClick={() => (allowMultiple ? toggle(choice.label) : onConfirm([{ ...choice, count: 1 }]))}
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
        {allowQuantity ? (
          <button
            onClick={confirmQuantity}
            disabled={totalCount === 0}
            className="w-full mt-4 py-3 bg-primary-500 hover:bg-primary-700 text-white text-sm font-bold rounded-xl transition-colors disabled:opacity-50"
          >
            決定{totalCount > 0 ? `（計${totalCount}点）` : ''}
          </button>
        ) : allowMultiple ? (
          <button
            onClick={confirmMulti}
            disabled={selected.length === 0}
            className="w-full mt-4 py-3 bg-primary-500 hover:bg-primary-700 text-white text-sm font-bold rounded-xl transition-colors disabled:opacity-50"
          >
            決定{selected.length > 0 ? `（${selected.length}件）` : ''}
          </button>
        ) : null}
      </div>
    </div>
  );
}
