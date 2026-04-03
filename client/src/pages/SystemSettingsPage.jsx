import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

// 32時間制のラベル生成
function hourLabel(h) {
  if (h < 24) return `${h}:00`;
  return `翌${h - 24}:00`;
}
const HOUR_OPTIONS = Array.from({ length: 33 }, (_, i) => i); // 0–32

function Section({ title, desc, children }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-6 py-4 bg-gray-50 border-b border-gray-100">
        <h3 className="text-sm font-bold text-gray-700">{title}</h3>
        {desc && <p className="text-xs text-gray-400 mt-0.5">{desc}</p>}
      </div>
      <div className="px-6 py-5">{children}</div>
    </div>
  );
}

function NumberPctInput({ value, onChange }) {
  return (
    <div className="flex items-center border border-gray-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-indigo-500 bg-white">
      <input
        type="number" min="0" max="100" step="1"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-24 px-3 py-2.5 text-sm text-gray-900 outline-none text-right"
      />
      <span className="px-3 py-2.5 text-sm text-gray-500 bg-gray-50 border-l border-gray-200">%</span>
    </div>
  );
}

function HourSelect({ value, onChange }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="bg-white border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors"
    >
      {HOUR_OPTIONS.map((h) => (
        <option key={h} value={h}>{hourLabel(h)}</option>
      ))}
    </select>
  );
}

export default function SystemSettingsPage() {
  const queryClient = useQueryClient();

  const [taxInput,  setTaxInput]  = useState('');
  const [lnRate,    setLnRate]    = useState('');
  const [lnStart,   setLnStart]   = useState(22);
  const [lnEnd,     setLnEnd]     = useState(29);
  const [savedTax,  setSavedTax]  = useState(false);
  const [savedLn,   setSavedLn]   = useState(false);

  const { data: settings, isLoading } = useQuery({
    queryKey: ['system-settings'],
    queryFn: api.getSystemSettings,
  });

  useEffect(() => {
    if (!settings) return;
    setTaxInput(String(Math.round(settings.tax_rate * 100)));
    setLnRate(String(Math.round(settings.late_night_rate * 100)));
    setLnStart(settings.late_night_start);
    setLnEnd(settings.late_night_end);
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: (data) => api.updateSystemSettings(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['system-settings'] }),
  });

  const handleSaveTax = () => {
    const pct = parseFloat(taxInput);
    if (isNaN(pct) || pct < 0 || pct > 100) return;
    saveMutation.mutate({ tax_rate: pct / 100 }, {
      onSuccess: () => { setSavedTax(true); setTimeout(() => setSavedTax(false), 2000); },
    });
  };

  const handleSaveLn = () => {
    const pct = parseFloat(lnRate);
    if (isNaN(pct) || pct < 0 || pct > 100) return;
    if (lnStart >= lnEnd) return;
    saveMutation.mutate(
      { late_night_rate: pct / 100, late_night_start: lnStart, late_night_end: lnEnd },
      { onSuccess: () => { setSavedLn(true); setTimeout(() => setSavedLn(false), 2000); } }
    );
  };

  const saveBtn = (saved, onClick) => (
    <button
      onClick={onClick}
      disabled={saveMutation.isPending}
      className={`px-5 py-2.5 rounded-lg text-sm font-bold transition-colors shadow-sm disabled:opacity-50 ${
        saved ? 'bg-emerald-500 text-white' : 'bg-indigo-600 hover:bg-indigo-700 text-white'
      }`}
    >
      {saved ? '保存しました' : '保存'}
    </button>
  );

  const taxPct = parseFloat(taxInput) || 0;
  const lnPct  = parseFloat(lnRate)   || 0;

  return (
    <div className="p-8 max-w-xl mx-auto space-y-6">
      {isLoading ? (
        <p className="text-sm text-gray-400">読み込み中...</p>
      ) : (
        <>
          {/* ── 消費税設定 ── */}
          <Section title="消費税設定" desc="会計時に適用される消費税率。変更後の会計から反映されます。">
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">消費税率（%）</label>
                <div className="flex items-center gap-3">
                  <NumberPctInput value={taxInput} onChange={setTaxInput} />
                  {saveBtn(savedTax, handleSaveTax)}
                </div>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm space-y-1">
                <p className="text-xs font-medium text-gray-500 mb-2">計算例（¥1,000 の場合）</p>
                <div className="flex justify-between text-gray-600">
                  <span>小計（税抜き）</span><span>¥1,000</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>消費税（{taxPct}%）</span>
                  <span>¥{Math.round(1000 * taxPct / 100).toLocaleString()}</span>
                </div>
                <div className="flex justify-between font-bold text-gray-900 pt-1 border-t border-gray-200 mt-1">
                  <span>合計（税込み）</span>
                  <span>¥{(1000 + Math.round(1000 * taxPct / 100)).toLocaleString()}</span>
                </div>
              </div>
            </div>
          </Section>

          {/* ── 深夜料金設定 ── */}
          <Section
            title="深夜料金設定"
            desc="指定時間帯の会計に加算される料金。開始・終了時刻は32時間制で入力（例: 翌3時 = 27）。"
          >
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">深夜料金率（%）</label>
                <NumberPctInput value={lnRate} onChange={setLnRate} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">開始時刻</label>
                  <HourSelect value={lnStart} onChange={setLnStart} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">終了時刻</label>
                  <HourSelect value={lnEnd} onChange={setLnEnd} />
                </div>
              </div>
              {lnStart >= lnEnd && (
                <p className="text-xs text-red-500">終了時刻は開始時刻より後にしてください</p>
              )}
              <div className="flex justify-end">
                {saveBtn(savedLn, handleSaveLn)}
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm space-y-1">
                <p className="text-xs font-medium text-amber-700 mb-2">
                  計算例（¥1,000 · {hourLabel(lnStart)}〜{hourLabel(lnEnd)} の会計）
                </p>
                <div className="flex justify-between text-amber-700">
                  <span>小計（税抜き）</span><span>¥1,000</span>
                </div>
                <div className="flex justify-between text-amber-700">
                  <span>深夜料金（{lnPct}%）</span>
                  <span>¥{Math.round(1000 * lnPct / 100).toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>消費税（{taxPct}%）</span>
                  <span>¥{Math.round((1000 + Math.round(1000 * lnPct / 100)) * taxPct / 100).toLocaleString()}</span>
                </div>
                <div className="flex justify-between font-bold text-gray-900 pt-1 border-t border-amber-200 mt-1">
                  <span>合計（税込み）</span>
                  <span>
                    ¥{(
                      1000 +
                      Math.round(1000 * lnPct / 100) +
                      Math.round((1000 + Math.round(1000 * lnPct / 100)) * taxPct / 100)
                    ).toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
