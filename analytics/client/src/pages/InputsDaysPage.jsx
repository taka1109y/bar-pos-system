import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Toolbar, Card, Alert, Badge, Button, Input, Field, Segmented, Textarea, Modal, Select, DataTable, Skeleton, cn } from '../components/ui';
import MonthBar from '../components/period/MonthBar';
import { todayJST } from '../utils/tz';
import { yen } from '../utils/format';
import { api } from '../api';
import { useToastStore } from '../store/useToastStore';
import { DOW_LABELS, yenShort } from '../components/charts/chartTheme';

// 営業日ノート・タグ入力(/inputs/days)。
// 月カレンダー(売上薄表示 + タグドット + 天候絵文字)から日を選び、右パネルで
// 営業/休業・天候・気温・メモ・タグを入力して PUT /api/v1/business-days/:date で保存する。
// タグ自体の追加・編集・削除(タグ管理)はモーダルで行う(/api/v1/tags CRUD)。

const MONTH_RE = /^\d{4}-\d{2}$/;

const WEATHER_EMOJI = { sunny: '☀️', cloudy: '☁️', rain: '🌧️', heavy_rain: '⛈️', snow: '❄️' };
const WEATHER_LABEL = { sunny: '晴れ', cloudy: '曇り', rain: '雨', heavy_rain: '大雨', snow: '雪' };

// 天候 Segmented(空文字 = 未入力に戻す)
const WEATHER_OPTIONS = [
  { value: '', label: 'なし' },
  { value: 'sunny', label: '☀️' },
  { value: 'cloudy', label: '☁️' },
  { value: 'rain', label: '🌧️' },
  { value: 'heavy_rain', label: '⛈️' },
  { value: 'snow', label: '❄️' },
];

const OPEN_OPTIONS = [
  { value: 'open', label: '営業' },
  { value: 'closed', label: '休業' },
];

// tags.color はセマンティック名(info/success/…)。ドット用に実色へ変換(CalendarPage と同じ規則)
const TAG_DOT_COLORS = { info: '#2b70ef', success: '#059669', warning: '#b45309', danger: '#dc2626', neutral: '#94a3b8' };
const tagDotColor = (color) => (typeof color === 'string' && color.startsWith('#') ? color : TAG_DOT_COLORS[color] || TAG_DOT_COLORS.neutral);

// tags.tag_group / color の選択肢(サーバの CHECK と同値)
const GROUP_OPTIONS = [
  { value: '', label: '(なし)' },
  { value: 'event', label: 'イベント' },
  { value: 'match', label: '試合' },
  { value: 'holiday', label: '祝日・連休' },
  { value: 'campaign', label: 'キャンペーン' },
  { value: 'weather', label: '天候' },
  { value: 'other', label: 'その他' },
];
const GROUP_LABELS = Object.fromEntries(GROUP_OPTIONS.filter((o) => o.value).map((o) => [o.value, o.label]));
const COLOR_OPTIONS = [
  { value: 'neutral', label: 'グレー' },
  { value: 'info', label: '青' },
  { value: 'success', label: '緑' },
  { value: 'warning', label: '黄' },
  { value: 'danger', label: '赤' },
];

// ── タグ管理モーダル(一覧 + 追加 + 有効/無効 + 削除) ──
function TagManagerModal({ onClose }) {
  const qc = useQueryClient();
  const push = useToastStore((s) => s.push);
  const [err, setErr] = useState(null);
  const [draft, setDraft] = useState({ code: '', name: '', tag_group: '', color: 'neutral' });

  const tagsQ = useQuery({ queryKey: ['v1', 'tags'], queryFn: api.getTags });
  const tags = tagsQ.data?.rows || [];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['v1', 'tags'] });
    qc.invalidateQueries({ queryKey: ['v1', 'business-days'] });
    qc.invalidateQueries({ queryKey: ['v1', 'calendar'] });
  };

  const createM = useMutation({
    mutationFn: () => api.createTag({
      code: draft.code.trim(),
      name: draft.name.trim(),
      tag_group: draft.tag_group || null,
      color: draft.color,
    }),
    onSuccess: () => {
      setErr(null);
      setDraft({ code: '', name: '', tag_group: '', color: 'neutral' });
      push('タグを追加しました', 'success');
      invalidate();
    },
    onError: (e) => setErr(e.message),
  });

  const toggleM = useMutation({
    mutationFn: (tag) => api.updateTag(tag.id, { is_active: !tag.is_active }),
    onSuccess: () => { setErr(null); invalidate(); },
    onError: (e) => setErr(e.message),
  });

  const deleteM = useMutation({
    mutationFn: (tag) => api.deleteTag(tag.id),
    onSuccess: () => { setErr(null); push('タグを削除しました', 'success'); invalidate(); },
    onError: (e) => setErr(e.message), // 使用日数>0 の 409 はサーバのメッセージをそのまま表示
  });

  const canCreate = draft.code.trim() !== '' && draft.name.trim() !== '' && !createM.isPending;

  const COLUMNS = [
    {
      key: 'name', header: 'タグ',
      render: (r) => (
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: tagDotColor(r.color) }} />
          <span className="text-heading font-medium">{r.name}</span>
          {!r.is_active && <Badge size="sm">無効</Badge>}
        </span>
      ),
    },
    { key: 'code', header: 'code', render: (r) => <code className="text-2xs">{r.code}</code> },
    { key: 'tag_group', header: 'グループ', render: (r) => GROUP_LABELS[r.tag_group] || '—' },
    { key: 'used_days', header: '使用日数', align: 'right', width: 80, render: (r) => <span className="tabular-nums">{r.used_days} 日</span> },
    {
      key: 'ops', header: '操作', align: 'right', width: 150,
      render: (r) => (
        <span className="inline-flex items-center gap-1.5">
          <Button variant="secondary" size="sm" onClick={() => toggleM.mutate(r)}
            loading={toggleM.isPending && toggleM.variables?.id === r.id}>
            {r.is_active ? '無効化' : '有効化'}
          </Button>
          <Button variant="danger" size="sm" onClick={() => deleteM.mutate(r)}
            loading={deleteM.isPending && deleteM.variables?.id === r.id}>
            削除
          </Button>
        </span>
      ),
    },
  ];

  return (
    <Modal title="タグ管理" size="lg" onClose={onClose}>
      <div className="space-y-3">
        {err && <Alert tone="danger" title="操作に失敗しました">{err}</Alert>}

        <div className="flex flex-wrap items-end gap-2">
          <Field label="code" htmlFor="tag-code" className="w-32" hint="英小文字・数字・-_">
            <Input id="tag-code" size="sm" value={draft.code} placeholder="例: rain-day"
              onChange={(e) => setDraft((d) => ({ ...d, code: e.target.value }))} />
          </Field>
          <Field label="名前" htmlFor="tag-name" className="w-36">
            <Input id="tag-name" size="sm" value={draft.name} placeholder="例: 雨の日"
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
          </Field>
          <Field label="グループ" htmlFor="tag-group">
            <Select id="tag-group" size="sm" className="w-32" value={draft.tag_group} options={GROUP_OPTIONS}
              onChange={(e) => setDraft((d) => ({ ...d, tag_group: e.target.value }))} />
          </Field>
          <Field label="色" htmlFor="tag-color">
            <Select id="tag-color" size="sm" className="w-24" value={draft.color} options={COLOR_OPTIONS}
              onChange={(e) => setDraft((d) => ({ ...d, color: e.target.value }))} />
          </Field>
          <Button size="sm" disabled={!canCreate} loading={createM.isPending} onClick={() => createM.mutate()}>追加</Button>
        </div>

        {tagsQ.isError ? (
          <Alert tone="danger" title="タグを取得できません">{tagsQ.error?.message}</Alert>
        ) : tagsQ.isLoading ? (
          <Skeleton height={160} />
        ) : (
          <DataTable
            columns={COLUMNS}
            rows={tags}
            rowKey={(r) => r.id}
            empty={<div className="py-8 text-center text-sm text-muted">タグがまだありません。上のフォームから追加してください。</div>}
          />
        )}
        <p className="text-2xs text-muted">
          使用中(使用日数&gt;0)のタグは削除できません。使わなくなったタグは「無効化」で選択肢から外れます(過去の営業日には残ります)。
        </p>
      </div>
    </Modal>
  );
}

export default function InputsDaysPage() {
  const qc = useQueryClient();
  const push = useToastStore((s) => s.push);
  const [month, setMonth] = useState(() => todayJST().slice(0, 7));
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(null); // { is_open, weather, temperature_c, note, tag_ids }
  const [tagModal, setTagModal] = useState(false);

  const monthValid = MONTH_RE.test(month);
  const daysQ = useQuery({
    queryKey: ['v1', 'business-days', month],
    queryFn: () => api.getBusinessDays(month),
    enabled: monthValid,
  });
  const tagsQ = useQuery({ queryKey: ['v1', 'tags'], queryFn: api.getTags });

  const days = daysQ.data?.days || [];
  const byDate = useMemo(() => new Map(days.map((d) => [d.business_date, d])), [days]);

  // 選択日が変わった時・保存後の再取得時に、フォームをサーバ値から作り直す
  useEffect(() => {
    if (!selected) { setForm(null); return; }
    const d = (daysQ.data?.days || []).find((x) => x.business_date === selected);
    setForm({
      is_open: d?.is_open ?? true, // 未入力日は営業を既定にする
      weather: d?.weather || '',
      temperature_c: d?.temperature_c == null ? '' : String(d.temperature_c),
      note: d?.note || '',
      tag_ids: (d?.tags || []).map((t) => t.id),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, daysQ.dataUpdatedAt]);

  // 月グリッド(日曜起点)。曜日計算は UTC 固定で閲覧端末のTZに依存させない(CalendarPage と同じ)。
  const cells = useMemo(() => {
    if (!monthValid) return [];
    const [y, m] = month.split('-').map(Number);
    const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const list = Array.from({ length: firstDow }, () => null);
    for (let d = 1; d <= daysInMonth; d++) list.push(`${month}-${String(d).padStart(2, '0')}`);
    return list;
  }, [month, monthValid]);

  const saveM = useMutation({
    mutationFn: () => api.putBusinessDay(selected, {
      is_open: form.is_open,
      weather: form.weather || null,
      temperature_c: form.temperature_c.trim() === '' ? null : Number(form.temperature_c),
      note: form.note.trim() === '' ? null : form.note.trim(),
      tag_ids: form.tag_ids,
    }),
    onSuccess: () => {
      push(`${selected} を保存しました`, 'success');
      qc.invalidateQueries({ queryKey: ['v1', 'business-days'] });
      qc.invalidateQueries({ queryKey: ['v1', 'tags'] });      // used_days が変わる
      qc.invalidateQueries({ queryKey: ['v1', 'calendar'] });  // カレンダーページの表示に反映
    },
    onError: (e) => push(`保存に失敗しました: ${e.message}`, 'danger'),
  });

  // タグ選択肢: 有効なタグ + (無効だが選択日に付いているタグ = 外せるように残す)
  const tagChoices = useMemo(() => {
    const rows = tagsQ.data?.rows || [];
    const ids = new Set(form?.tag_ids || []);
    return rows.filter((t) => t.is_active || ids.has(t.id));
  }, [tagsQ.data, form]);

  const toggleTag = (id) => setForm((f) => ({
    ...f,
    tag_ids: f.tag_ids.includes(id) ? f.tag_ids.filter((x) => x !== id) : [...f.tag_ids, id],
  }));

  const tempNum = Number(form?.temperature_c);
  const tempInvalid = !!form && form.temperature_c.trim() !== ''
    && !(Number.isFinite(tempNum) && tempNum >= -50 && tempNum <= 50);

  const selectedDay = selected ? byDate.get(selected) : null;

  return (
    <div className="space-y-5">
      <Toolbar title="営業日ノート・タグ" subtitle="営業/休業・天候・気温・メモ・タグを営業日ごとに記録する">
        <Button variant="secondary" onClick={() => setTagModal(true)}>タグ管理</Button>
      </Toolbar>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 items-start">
        <Card
          className="xl:col-span-2"
          dense
          title="月間カレンダー"
          actions={<MonthBar month={month} onChange={(m) => { setSelected(null); setMonth(m); }} />}
        >
          {daysQ.isError ? (
            <Alert tone="danger" title="営業日ノートを取得できません">{daysQ.error?.message}</Alert>
          ) : daysQ.isLoading ? (
            <Skeleton height={420} />
          ) : (
            <>
              <div className="grid grid-cols-7 gap-1.5 mb-1.5">
                {DOW_LABELS.map((d, i) => (
                  <div key={d} className={cn('text-center text-2xs font-semibold', i === 0 ? 'text-danger' : i === 6 ? 'text-primary-600' : 'text-muted')}>
                    {d}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1.5">
                {cells.map((date, i) => {
                  if (!date) return <div key={`blank-${i}`} aria-hidden="true" />;
                  const d = byDate.get(date);
                  const isSelected = selected === date;
                  const closed = d?.is_open === false;
                  return (
                    <button
                      key={date}
                      type="button"
                      onClick={() => setSelected(date)}
                      aria-pressed={isSelected}
                      aria-label={`${date} を編集`}
                      className={cn(
                        'relative min-h-20 rounded-lg border p-1.5 text-left flex flex-col gap-0.5 bg-surface transition-colors cursor-pointer',
                        isSelected ? 'border-primary-500 ring-2 ring-primary-500/30' : 'border-line hover:border-line-strong',
                        closed && 'opacity-60'
                      )}
                    >
                      <div className="flex items-start justify-between gap-1">
                        <span className="text-xs font-semibold text-heading tabular-nums">{Number(date.slice(8))}</span>
                        {d?.weather && <span className="text-xs leading-none" title={WEATHER_LABEL[d.weather] || d.weather}>{WEATHER_EMOJI[d.weather] || ''}</span>}
                      </div>
                      {Number(d?.revenue) > 0 ? (
                        <span className="text-2xs text-muted tabular-nums">¥{yenShort(d.revenue)}</span>
                      ) : closed ? (
                        <span className="text-2xs text-muted">休</span>
                      ) : null}
                      {(d?.tags || []).length > 0 && (
                        <span className="mt-auto flex items-center gap-1 flex-wrap">
                          {d.tags.map((t) => (
                            <span key={t.id} className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: tagDotColor(t.color) }} title={t.name} />
                          ))}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-2xs text-muted">日付をクリックすると右のパネルで編集できます。ドット = タグ、絵文字 = 天候、金額 = その営業日の売上。</p>
            </>
          )}
        </Card>

        <Card title={selected ? `${selected} の記録` : '営業日の記録'} dense>
          {!selected || !form ? (
            <p className="text-sm text-muted py-8 text-center">カレンダーの日付をクリックすると、その営業日の記録を入力できます。</p>
          ) : (
            <div className="space-y-3">
              {selectedDay && Number(selectedDay.revenue) > 0 && (
                <div className="text-xs text-muted">
                  実績: 売上 <span className="text-heading font-medium tabular-nums">¥{yen(selectedDay.revenue)}</span>
                  {' / '}{yen(selectedDay.order_count)} 件{' / '}{yen(selectedDay.guest_count)} 人
                </div>
              )}
              <Field label="営業 / 休業">
                <Segmented
                  options={OPEN_OPTIONS}
                  value={form.is_open ? 'open' : 'closed'}
                  onChange={(v) => setForm((f) => ({ ...f, is_open: v === 'open' }))}
                />
              </Field>
              <Field label="天候">
                <Segmented
                  options={WEATHER_OPTIONS}
                  value={form.weather}
                  onChange={(v) => setForm((f) => ({ ...f, weather: v }))}
                />
              </Field>
              <Field label="気温" htmlFor="day-temp" error={tempInvalid ? '-50〜50 の数値を指定してください' : undefined} className="w-32">
                <Input id="day-temp" type="number" step="0.1" min={-50} max={50} suffix="℃"
                  value={form.temperature_c} invalid={tempInvalid} placeholder="例: 28.5"
                  onChange={(e) => setForm((f) => ({ ...f, temperature_c: e.target.value }))} />
              </Field>
              <Field label="タグ">
                {tagChoices.length === 0 ? (
                  <p className="text-xs text-muted">タグがありません。「タグ管理」から追加してください。</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {tagChoices.map((t) => {
                      const on = form.tag_ids.includes(t.id);
                      return (
                        <button
                          key={t.id}
                          type="button"
                          aria-pressed={on}
                          onClick={() => toggleTag(t.id)}
                          className={cn(
                            'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-xs font-medium border cursor-pointer transition-colors',
                            on ? 'bg-primary-50 border-primary-500 text-primary-700' : 'bg-surface border-line-strong text-body hover:bg-surface-hover'
                          )}
                        >
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: tagDotColor(t.color) }} />
                          {t.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </Field>
              <Field label="メモ" htmlFor="day-note">
                <Textarea id="day-note" rows={3} value={form.note} placeholder="例: 近隣で花火大会。21時以降に集中"
                  onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
              </Field>
              <div className="flex justify-end">
                <Button onClick={() => saveM.mutate()} disabled={tempInvalid} loading={saveM.isPending}>保存</Button>
              </div>
            </div>
          )}
        </Card>
      </div>

      {tagModal && <TagManagerModal onClose={() => setTagModal(false)} />}
    </div>
  );
}
