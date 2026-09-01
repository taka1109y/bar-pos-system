import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Toolbar, Card, Alert, Button, Input, Field, Select, Segmented, Skeleton } from '../components/ui';
import { api } from '../api';
import { fmtDateTime } from '../utils/datetime';
import { useToastStore } from '../store/useToastStore';
import { DOW_LABELS } from '../components/charts/chartTheme';

// 店舗設定(/settings-store)。store_settings(1行固定)の参照・更新。
// 営業日境界時刻・週開始曜日・年度開始月・ABC閾値・既定の日付基準を GET/PATCH /api/v1/settings で扱う。
// 境界時刻を変更すると PATCH 応答に warning が付くので Alert で表示する。

const BOUNDARY_OPTIONS = Array.from({ length: 13 }, (_, h) => ({ value: String(h), label: `${h}:00` }));
const DOW_OPTIONS = DOW_LABELS.map((label, i) => ({ value: String(i), label: `${label}曜日` }));
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}月` }));
const DAY_MODE_OPTIONS = [
  { value: 'business', label: '営業日' },
  { value: 'calendar', label: '暦日' },
];

// ABC閾値の検証(サーバと同値: A は 1〜99、B は 2〜100 の整数)
function pctError(v, min, max) {
  const n = Number(String(v ?? '').trim());
  return Number.isInteger(n) && n >= min && n <= max ? null : `${min}〜${max} の整数を指定してください`;
}

export default function StoreSettingsPage() {
  const qc = useQueryClient();
  const push = useToastStore((s) => s.push);
  const [form, setForm] = useState(null);
  const [warning, setWarning] = useState(null);

  const settingsQ = useQuery({ queryKey: ['v1', 'settings'], queryFn: api.getSettings });

  // 取得(保存後の再取得含む)のたびにサーバ値からフォームを作り直す
  useEffect(() => {
    const d = settingsQ.data;
    if (!d) return;
    setForm({
      business_day_boundary_hour: String(d.business_day_boundary_hour),
      week_start_dow: String(d.week_start_dow),
      fiscal_year_start_month: String(d.fiscal_year_start_month),
      default_day_mode: d.default_day_mode,
      abc_a_pct: String(d.abc_a_pct),
      abc_b_pct: String(d.abc_b_pct),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsQ.dataUpdatedAt]);

  const aErr = form ? pctError(form.abc_a_pct, 1, 99) : null;
  const bErr = form ? pctError(form.abc_b_pct, 2, 100) : null;
  const abErr = form && !aErr && !bErr && Number(form.abc_a_pct) >= Number(form.abc_b_pct)
    ? 'A のしきい値は B より小さくしてください' : null;
  const invalid = !!(aErr || bErr || abErr);

  const saveM = useMutation({
    mutationFn: () => api.patchSettings({
      business_day_boundary_hour: Number(form.business_day_boundary_hour),
      week_start_dow: Number(form.week_start_dow),
      fiscal_year_start_month: Number(form.fiscal_year_start_month),
      default_day_mode: form.default_day_mode,
      abc_a_pct: Number(form.abc_a_pct),
      abc_b_pct: Number(form.abc_b_pct),
    }),
    onSuccess: (d) => {
      setWarning(d?.warning || null);
      push('設定を保存しました', 'success');
      qc.invalidateQueries(); // 境界・週・年度の変更は全集計と meta(バナー)に影響するため全て再取得
    },
    onError: (e) => push(`保存に失敗しました: ${e.message}`, 'danger'),
  });

  return (
    <div className="space-y-5">
      <Toolbar title="店舗設定" subtitle="営業日の境界・週の開始・年度・ABC分析のしきい値・既定の日付基準">
        <Button onClick={() => saveM.mutate()} disabled={!form || invalid} loading={saveM.isPending}>保存</Button>
      </Toolbar>

      {warning && (
        <Alert tone="warning" title="営業日境界を変更しました">{warning}</Alert>
      )}

      {settingsQ.isError ? (
        <Alert tone="danger" title="設定を取得できません">{settingsQ.error?.message}</Alert>
      ) : !form ? (
        <Skeleton height={320} />
      ) : (
        <>
          <Card title="営業日と期間の基準" dense>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl">
              <Field
                label="営業日の境界時刻"
                htmlFor="set-boundary"
                hint={`深夜${form.business_day_boundary_hour}時までの会計を前日の営業日に含めます`}
              >
                <Select
                  id="set-boundary" className="w-32"
                  value={form.business_day_boundary_hour}
                  options={BOUNDARY_OPTIONS}
                  onChange={(e) => setForm((f) => ({ ...f, business_day_boundary_hour: e.target.value }))}
                />
              </Field>
              <Field label="既定の日付基準" hint="各ページを開いたときの初期の集計基準">
                <Segmented
                  options={DAY_MODE_OPTIONS}
                  value={form.default_day_mode}
                  onChange={(v) => setForm((f) => ({ ...f, default_day_mode: v }))}
                />
              </Field>
              <Field label="週の開始曜日" htmlFor="set-dow" hint="週次集計・「今週/先週」プリセットの区切り">
                <Select
                  id="set-dow" className="w-32"
                  value={form.week_start_dow}
                  options={DOW_OPTIONS}
                  onChange={(e) => setForm((f) => ({ ...f, week_start_dow: e.target.value }))}
                />
              </Field>
              <Field label="年度の開始月" htmlFor="set-fy" hint="年度粒度・目標管理の「年度」の起点">
                <Select
                  id="set-fy" className="w-32"
                  value={form.fiscal_year_start_month}
                  options={MONTH_OPTIONS}
                  onChange={(e) => setForm((f) => ({ ...f, fiscal_year_start_month: e.target.value }))}
                />
              </Field>
            </div>
          </Card>

          <Card title="ABC分析のしきい値" dense>
            <div className="flex flex-wrap items-end gap-4">
              <Field label="Aランク(累積構成比)" htmlFor="set-abc-a" className="w-44" error={aErr || abErr || undefined}>
                <Input
                  id="set-abc-a" type="number" min={1} max={99} suffix="%"
                  value={form.abc_a_pct} invalid={!!(aErr || abErr)}
                  onChange={(e) => setForm((f) => ({ ...f, abc_a_pct: e.target.value }))}
                />
              </Field>
              <Field label="Bランク(累積構成比)" htmlFor="set-abc-b" className="w-44" error={bErr || undefined}>
                <Input
                  id="set-abc-b" type="number" min={2} max={100} suffix="%"
                  value={form.abc_b_pct} invalid={!!(bErr || abErr)}
                  onChange={(e) => setForm((f) => ({ ...f, abc_b_pct: e.target.value }))}
                />
              </Field>
            </div>
            <p className="mt-2 text-2xs text-muted">
              売上の累積構成比が A% までの商品を Aランク、B% までを Bランク、それ以外を Cランクに分類します(商品ランキング&ABC で使用)。
            </p>
          </Card>

          <p className="text-2xs text-muted">最終更新: {fmtDateTime(settingsQ.data?.updated_at)}</p>
        </>
      )}
    </div>
  );
}
