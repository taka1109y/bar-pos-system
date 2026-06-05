import { useState } from 'react';

const BLUE_HEADER = 'bg-primary-500 text-white';
const BLUE_BTN    = 'bg-primary-500 hover:bg-primary-600 active:bg-primary-700 text-white font-bold rounded transition-colors';

export const DENOMS = [
  { label: '1万円', value: 10000 },
  { label: '5千円', value: 5000 },
  { label: '2千円', value: 2000 },
  { label: '1千円', value: 1000 },
  { label: '500円', value: 500 },
  { label: '100円', value: 100 },
  { label: '50円',  value: 50 },
  { label: '10円',  value: 10 },
  { label: '5円',   value: 5 },
  { label: '1円',   value: 1 },
];

const TENKEY_ROWS = [['7','8','9'],['4','5','6'],['1','2','3'],['C','0','⌫']];

// props:
//   denomCounts  : { [denomValue]: string }
//   onChange     : (denomValue, countStr) => void
//   onConfirm    : (total: number) => void
//   onCancel     : () => void
//   title        : string (省略時 "現金在高　金種入力")
export default function CashDenomModal({ denomCounts, onChange, onConfirm, onCancel, title }) {
  const [focusedDenom, setFocusedDenom] = useState(null);

  const total = DENOMS.reduce(
    (sum, d) => sum + (parseInt(denomCounts[d.value] ?? '', 10) || 0) * d.value,
    0
  );

  const handleTenkey = (key) => {
    if (focusedDenom === null) return;
    const current = denomCounts[focusedDenom] ?? '';
    if (key === 'C') {
      onChange(focusedDenom, '');
    } else if (key === '⌫') {
      onChange(focusedDenom, current.slice(0, -1));
    } else {
      onChange(focusedDenom, current + key);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
      <div className="bg-white rounded-xl shadow-xl overflow-hidden flex flex-col" style={{ width: 780 }}>
        {/* ヘッダー */}
        <div className={`px-6 py-3 flex-shrink-0 ${BLUE_HEADER}`}>
          <h3 className="text-[16px] font-bold">{title ?? '現金在高　金種入力'}</h3>
        </div>

        {/* ボディ: 内側4辺に余白 */}
        <div className="flex p-4 gap-4 overflow-hidden">
          {/* ══ 左: 金種リスト ══ */}
          <div className="flex flex-col border border-slate-200 rounded-lg overflow-hidden" style={{ width: 440 }}>
            {/* 列ヘッダー */}
            <div className="flex items-center px-5 py-2 bg-slate-50 border-b border-slate-200 flex-shrink-0">
              <span className="w-16 text-[13px] font-bold text-slate-400">金種</span>
              <span className="flex-1 text-right text-[13px] font-bold text-slate-400 pr-2">枚数</span>
              <span className="w-28 text-right text-[13px] font-bold text-slate-400">小計</span>
            </div>

            {/* 金種行 */}
            <div className="flex-1 overflow-y-auto">
              {DENOMS.map((d) => {
                const count     = parseInt(denomCounts[d.value] ?? '', 10) || 0;
                const subtotal  = count * d.value;
                const isFocused = focusedDenom === d.value;
                return (
                  <div
                    key={d.value}
                    className={`flex items-center gap-3 px-5 py-3 border-b border-slate-100 last:border-0 cursor-pointer ${isFocused ? 'bg-primary-50' : 'hover:bg-slate-50'}`}
                    onClick={() => setFocusedDenom(d.value)}
                  >
                    <span className={`w-16 text-[15px] flex-shrink-0 ${isFocused ? 'text-primary-600 font-bold' : 'text-slate-700'}`}>
                      {d.label}
                    </span>
                    <div className="flex-1">
                      {/* readOnly + inputMode="none" でiPadの標準キーボードを抑制 */}
                      <input
                        type="text"
                        inputMode="none"
                        readOnly
                        tabIndex={-1}
                        value={denomCounts[d.value] ?? ''}
                        placeholder="0"
                        className={`w-full text-right text-[15px] tabular-nums border rounded bg-white px-2 py-1 focus:outline-none cursor-default ${isFocused ? 'border-primary-400 ring-1 ring-primary-400' : 'border-slate-200'}`}
                      />
                    </div>
                    <span className="w-28 text-right text-[15px] tabular-nums text-slate-700 flex-shrink-0">
                      {subtotal > 0 ? `¥${subtotal.toLocaleString()}` : ''}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* 合計 */}
            <div className="flex items-center px-5 py-2.5 border-t-2 border-primary-400 bg-primary-50 flex-shrink-0">
              <span className="flex-1 text-[15px] font-bold text-slate-700">合計</span>
              <span className="text-[19px] font-black text-primary-600 tabular-nums">
                ¥{total.toLocaleString()}
              </span>
            </div>
          </div>

          {/* ══ 右: テンキー ══ */}
          <div className="flex flex-col gap-3" style={{ width: 300 }}>
            {/* 選択中の金種・入力値表示 */}
            <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 min-h-[60px] flex flex-col justify-center">
              {focusedDenom ? (
                <>
                  <span className="text-[13px] text-slate-400">
                    {DENOMS.find(d => d.value === focusedDenom)?.label}
                  </span>
                  <span className="text-[20px] font-bold text-primary-600 tabular-nums text-right leading-tight">
                    {denomCounts[focusedDenom] || '0'} 枚
                  </span>
                </>
              ) : (
                <span className="text-[14px] text-slate-400 text-center">← 金種を選択</span>
              )}
            </div>

            {/* テンキーグリッド */}
            <div className="grid grid-cols-3 gap-2 flex-1">
              {TENKEY_ROWS.flat().map((key) => {
                const isSpecial  = key === 'C' || key === '⌫';
                const isDisabled = focusedDenom === null;
                return (
                  <button
                    key={key}
                    onClick={() => handleTenkey(key)}
                    disabled={isDisabled}
                    className={`flex items-center justify-center rounded-lg text-[18px] font-bold h-16 select-none transition-colors
                      ${isDisabled
                        ? 'bg-slate-100 text-slate-300 cursor-default'
                        : isSpecial
                          ? 'bg-slate-200 hover:bg-slate-300 active:bg-slate-400 text-slate-600'
                          : 'bg-white border border-slate-200 hover:bg-primary-50 hover:border-primary-300 active:bg-primary-100 text-slate-800'
                      }`}
                  >
                    {key}
                  </button>
                );
              })}
            </div>

            {/* キャンセル・確定ボタン */}
            <div className="flex gap-2">
              <button
                onClick={onCancel}
                className="flex-1 py-3 text-[14px] font-bold border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
              >
                キャンセル
              </button>
              <button
                onClick={() => onConfirm(total)}
                className={`flex-1 py-3 text-[14px] font-bold rounded-lg ${BLUE_BTN}`}
              >
                確定
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
