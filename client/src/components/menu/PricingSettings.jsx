import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';

const inp =
  'w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 caret-primary-500 transition-colors';

const lbl = 'block text-xs font-semibold text-slate-500 mb-1.5';

const FIELD_META = [
  {
    key: 'TICK_INTERVAL_MS',
    label: 'ティック間隔',
    unit: 'ms',
    desc: '価格再計算の実行間隔。変更はすぐに反映されます。',
    min: 5000,
    step: 1000,
  },
  {
    key: 'WINDOW_SECONDS',
    label: '需要計測ウィンドウ',
    unit: '秒',
    desc: '過去何秒間の注文を需要として計測するか。',
    min: 60,
    step: 60,
  },
  {
    key: 'PRICE_STEP_DOWN',
    label: '価格下降ステップ',
    unit: '割合',
    desc: '需要がない場合に1ティックあたり何割ずつ基準価格へ戻すか (例: 0.04 = 4%)。',
    min: 0.01,
    max: 0.5,
    step: 0.01,
  },
];

export default function PricingSettings() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(null);
  const [saved, setSaved] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['pricingSettings'],
    queryFn: api.getPricingSettings,
    staleTime: 0,
  });

  const updateMutation = useMutation({
    mutationFn: api.updatePricingSettings,
    onSuccess: (res) => {
      queryClient.setQueryData(['pricingSettings'], (old) => ({ ...old, settings: res.settings }));
      setDraft({ ...res.settings });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const resetMutation = useMutation({
    mutationFn: api.resetPricingSettings,
    onSuccess: (res) => {
      queryClient.setQueryData(['pricingSettings'], (old) => ({ ...old, settings: res.settings }));
      setDraft({ ...res.settings });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  if (isLoading || !data) {
    return <div className="p-8 text-sm text-slate-400">読み込み中...</div>;
  }

  // data 取得後に draft を初期化 (まだ未設定の場合)
  const currentDraft = draft ?? data.settings;
  const defaults = data.defaults;
  const isDirty = FIELD_META.some((f) => currentDraft[f.key] !== data.settings[f.key]);

  const handleChange = (key, value) => {
    setDraft((prev) => ({ ...(prev ?? data.settings), [key]: Number(value) }));
  };

  const handleSave = () => {
    updateMutation.mutate(currentDraft);
  };

  const handleReset = () => {
    if (window.confirm('すべてデフォルト値に戻しますか？')) {
      resetMutation.mutate();
    }
  };

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <div className="mb-6">
        <h2 className="text-base font-bold text-slate-900">価格エンジン設定</h2>
        <p className="text-xs text-slate-400 mt-1">
          ダイナミックプライシングのパラメータをリアルタイムで変更できます。
        </p>
      </div>

      <div className="space-y-4">
        {FIELD_META.map((field) => {
          const current = currentDraft[field.key];
          const def = defaults[field.key];
          const isChanged = current !== def;

          return (
            <div key={field.key} className="bg-white rounded-xl border border-slate-200 p-6">
              <div className="flex items-start justify-between gap-4 mb-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-800">{field.label}</span>
                    {isChanged && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded font-medium">
                        変更済
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">{field.desc}</p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <input
                    type="number"
                    value={current}
                    onChange={(e) => handleChange(field.key, e.target.value)}
                    min={field.min}
                    max={field.max}
                    step={field.step}
                    className={`${inp} w-28 text-right`}
                  />
                  <span className="text-xs text-slate-400 w-8">{field.unit}</span>
                </div>
              </div>
              <div className="text-xs text-slate-400">
                デフォルト: <span className="font-mono text-slate-500">{def}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-3 mt-6">
        <button
          onClick={handleSave}
          disabled={!isDirty || updateMutation.isPending}
          className="inline-flex items-center justify-center gap-2 h-10 px-4 text-sm font-semibold bg-primary-500 text-white rounded-lg hover:bg-primary-700 cursor-pointer disabled:opacity-40 transition-colors"
        >
          {updateMutation.isPending ? '保存中...' : '変更を保存'}
        </button>
        <button
          onClick={handleReset}
          disabled={resetMutation.isPending}
          className="inline-flex items-center justify-center gap-2 h-10 px-4 text-sm font-medium bg-white text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer disabled:opacity-40 transition-colors"
        >
          デフォルトに戻す
        </button>
        {saved && (
          <div className="flex items-start gap-3 px-4 py-2.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-xs font-medium">
            ✓ 保存しました
          </div>
        )}
        {(updateMutation.isError || resetMutation.isError) && (
          <span className="text-xs text-red-500">
            {updateMutation.error?.message ?? resetMutation.error?.message}
          </span>
        )}
      </div>
    </div>
  );
}
