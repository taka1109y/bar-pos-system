import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { Toolbar, Card, Alert, Badge, Button, Input, Field, Select, Textarea, Modal, Segmented, Tabs, DataTable, StatTile, Skeleton, cn } from '../components/ui';
import ExportCsvButton from '../components/ExportCsvButton';
import { todayJST, TZ } from '../utils/tz';
import { yen, num } from '../utils/format';
import { api } from '../api';
import { useToastStore } from '../store/useToastStore';
import { DOW_LABELS } from '../components/charts/chartTheme';

// スタッフ・シフト入力(/inputs/shifts)。
// [シフト]週グリッド(スタッフ×営業日)でシフトを登録・編集し、週の労働時間・人件費を出す。
// [スタッフ]スタッフのCRUD(時給の変更は staff_wage_history に営業日基準で記録される)。
// 週の開始曜日は店舗設定(week_start_dow)、時刻は営業日境界(business_day_boundary_hour)基準で、
// 境界より前の時刻(例: 境界9時なら 02:00)は「その営業日の深夜」= 翌暦日として保存する。

const FMT = 'YYYY-MM-DD';
const TIME_RE = /^\d{2}:\d{2}/;
const MAX_WAGE = 100_000;
const MAX_SALARY = 10_000_000;
const MAX_BREAK = 1440;

const EMPLOYMENT_OPTIONS = [
  { value: 'hourly',  label: '時給制' },
  { value: 'monthly', label: '月給制' },
  { value: 'owner',   label: 'オーナー' },
];
const EMPLOYMENT_LABELS = Object.fromEntries(EMPLOYMENT_OPTIONS.map((o) => [o.value, o.label]));

const TABS = [
  { id: 'shifts', label: 'シフト' },
  { id: 'staff',  label: 'スタッフ' },
];

// ── 時刻ヘルパ(すべて JST 固定) ───────────────────
const TIME_FMT = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const DATE_FMT = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

// ISO(TIMESTAMPTZ) → 'HH:MM'(JST)
const jstTime = (iso) => (iso ? TIME_FMT.format(new Date(iso)) : '');
// ISO → 'YYYY-MM-DD'(JST)
const jstDate = (iso) => (iso ? DATE_FMT.format(new Date(iso)) : '');

// 'HH:MM' → 32時間表記の時(小数)。境界より前は +24(例: 境界9で 02:00 → 26.0)
function hour32(hhmm, boundary) {
  if (!TIME_RE.test(hhmm || '')) return null;
  const [h, m] = hhmm.split(':').map(Number);
  return (h < boundary ? h + 24 : h) + m / 60;
}

// 32時間表記のラベル('26:30' のように 24 超で表示する)
function fmtH32(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const h = Math.floor(v);
  const m = Math.round((v - h) * 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}

// 入力中の 'HH:MM' を 32時間表記ラベルにする(境界より前は +24)
function label32(hhmm, boundary) {
  const v = hour32(hhmm, boundary);
  return v == null ? (hhmm || '—') : fmtH32(v);
}

// 保存済みシフトの時刻ラベル。営業日からの暦日ずれで 24 を足す(境界に依らず正確)
function stampLabel(iso, businessDate) {
  if (!iso) return '—';
  const [h, m] = jstTime(iso).split(':').map(Number);
  const offset = dayjs(jstDate(iso)).diff(dayjs(businessDate), 'day');
  return fmtH32(h + m / 60 + 24 * Math.max(0, offset));
}

// 営業日 + 'HH:MM' → ISO(JST)。境界より前の時刻は翌暦日、extraDays でさらに +n 日
function toIso(businessDate, hhmm, boundary, extraDays = 0) {
  const [h, m] = hhmm.split(':').map(Number);
  const dayOffset = (h < boundary ? 1 : 0) + extraDays;
  const d = dayjs(businessDate).add(dayOffset, 'day').format(FMT);
  return `${d}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+09:00`;
}

// 週の開始日(week_start_dow 基準)
function weekStartOf(date, dow) {
  const d = dayjs(date);
  return d.subtract((d.day() - dow + 7) % 7, 'day').format(FMT);
}

const fmtMinutes = (minutes) => `${Math.floor(minutes / 60)}:${String(Math.round(minutes % 60)).padStart(2, '0')}`;
const dowLabel = (ymd) => DOW_LABELS[dayjs(ymd).day()] || '';

function wageError(v) {
  const s = String(v ?? '').trim();
  if (s === '') return true;
  const n = Number(s);
  return !(Number.isInteger(n) && n >= 0 && n <= MAX_WAGE);
}
function salaryError(v) {
  const s = String(v ?? '').trim();
  if (s === '') return true;
  const n = Number(s);
  return !(Number.isInteger(n) && n >= 0 && n <= MAX_SALARY);
}
function breakError(v) {
  const s = String(v ?? '').trim();
  if (s === '') return true;
  const n = Number(s);
  return !(Number.isInteger(n) && n >= 0 && n <= MAX_BREAK);
}

// ── シフト入力モーダル(新規・編集・削除) ───────────
function ShiftModal({ shift, staffId, staffList, businessDate, boundary, onClose }) {
  const qc = useQueryClient();
  const push = useToastStore((s) => s.push);
  const isEdit = Boolean(shift);
  const [err, setErr] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [form, setForm] = useState(() => ({
    staff_id: String(shift ? shift.staff_id : staffId || ''),
    business_date: shift ? shift.business_date : businessDate,
    start: shift ? jstTime(shift.start_at) : '18:00',
    end: shift ? jstTime(shift.end_at) : '23:00',
    break_minutes: String(shift ? shift.break_minutes ?? 0 : 0),
    memo: shift?.memo ?? '',
  }));
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const startH = hour32(form.start, boundary);
  const endH0 = hour32(form.end, boundary);
  const endH = startH != null && endH0 != null && endH0 <= startH ? endH0 + 24 : endH0;
  const spanMinutes = startH != null && endH != null ? Math.round((endH - startH) * 60) : null;
  const workMinutes = spanMinutes != null && !breakError(form.break_minutes)
    ? Math.max(0, spanMinutes - Number(form.break_minutes))
    : null;
  const wage = useMemo(() => {
    if (shift) return shift.hourly_wage_snapshot;
    const st = staffList.find((s) => String(s.id) === String(form.staff_id));
    return st ? st.current_wage : null;
  }, [shift, staffList, form.staff_id]);
  const laborCost = workMinutes != null && wage != null ? Math.round((workMinutes / 60) * wage) : null;

  const timesValid = startH != null && endH != null && spanMinutes > 0 && spanMinutes <= 24 * 60;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['v1', 'shifts'] });
    qc.invalidateQueries({ queryKey: ['v1', 'staff'] });
    qc.invalidateQueries({ queryKey: ['v1', 'labor'] });
    qc.invalidateQueries({ queryKey: ['v1', 'pl'] });
  };

  const body = () => ({
    business_date: form.business_date,
    start_at: toIso(form.business_date, form.start, boundary),
    end_at: toIso(form.business_date, form.end, boundary, endH0 <= startH ? 1 : 0),
    break_minutes: Number(String(form.break_minutes).trim()),
    memo: form.memo.trim() || null,
  });

  const saveM = useMutation({
    mutationFn: () => (isEdit
      ? api.updateShift(shift.id, body())
      : api.createShift({ staff_id: Number(form.staff_id), ...body() })),
    onSuccess: () => { push(isEdit ? 'シフトを更新しました' : 'シフトを登録しました', 'success'); invalidate(); onClose(); },
    onError: (e) => setErr(e.message), // 重複(409)はサーバのメッセージをそのまま表示
  });

  const delM = useMutation({
    mutationFn: () => api.deleteShift(shift.id),
    onSuccess: () => { push('シフトを削除しました', 'success'); invalidate(); onClose(); },
    onError: (e) => setErr(e.message),
  });

  const canSave = form.staff_id !== '' && form.business_date && timesValid && !breakError(form.break_minutes) && !saveM.isPending;

  return (
    <Modal
      title={isEdit ? 'シフトを編集' : 'シフトを追加'}
      onClose={onClose}
      footer={(
        <>
          {isEdit && (confirmDelete ? (
            <Button variant="danger" onClick={() => delM.mutate()} loading={delM.isPending} className="mr-auto">本当に削除する</Button>
          ) : (
            <Button variant="ghost" onClick={() => setConfirmDelete(true)} className="mr-auto">削除</Button>
          ))}
          <Button variant="secondary" onClick={onClose}>キャンセル</Button>
          <Button onClick={() => saveM.mutate()} disabled={!canSave} loading={saveM.isPending}>保存</Button>
        </>
      )}
    >
      <div className="space-y-3">
        {err && <Alert tone="danger" title="保存に失敗しました">{err}</Alert>}

        <div className="grid grid-cols-2 gap-3">
          <Field label="スタッフ" htmlFor="shift-staff" required>
            {isEdit ? (
              <div className="h-9 flex items-center text-sm text-heading font-medium">{shift.staff_name}</div>
            ) : (
              <Select id="shift-staff" value={form.staff_id} invalid={form.staff_id === ''}
                options={[{ value: '', label: 'スタッフを選択' }, ...staffList.map((s) => ({ value: String(s.id), label: s.name }))]}
                onChange={(e) => set({ staff_id: e.target.value })} />
            )}
          </Field>
          <Field label="営業日" htmlFor="shift-date" required>
            <Input id="shift-date" type="date" value={form.business_date}
              onChange={(e) => e.target.value && set({ business_date: e.target.value })} />
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Field label="開始" htmlFor="shift-start" required>
            <Input id="shift-start" type="time" value={form.start} invalid={startH == null}
              onChange={(e) => set({ start: e.target.value })} />
          </Field>
          <Field label="終了" htmlFor="shift-end" required error={!timesValid && startH != null && endH0 != null ? '24時間以内にしてください' : undefined}>
            <Input id="shift-end" type="time" value={form.end} invalid={endH0 == null || !timesValid}
              onChange={(e) => set({ end: e.target.value })} />
          </Field>
          <Field label="休憩(分)" htmlFor="shift-break" error={breakError(form.break_minutes) ? `0〜${MAX_BREAK} の整数` : undefined}>
            <Input id="shift-break" type="number" min={0} max={MAX_BREAK} className="text-right"
              value={form.break_minutes} invalid={breakError(form.break_minutes)}
              onChange={(e) => set({ break_minutes: e.target.value })} />
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-4 p-3 rounded-lg bg-surface-sunken border border-line text-sm">
          <span className="text-muted">
            {form.business_date}({dowLabel(form.business_date)}) の{' '}
            <span className="text-heading font-medium tabular-nums">
              {label32(form.start, boundary)}〜{fmtH32(endH)}
            </span>
          </span>
          <span className="text-muted">実働 <span className="text-heading font-medium tabular-nums">{workMinutes != null ? `${fmtMinutes(workMinutes)}` : '—'}</span></span>
          <span className="text-muted">
            人件費(概算) <span className="text-heading font-medium tabular-nums">{laborCost != null ? `¥${yen(laborCost)}` : '—'}</span>
            {wage != null && <span className="ml-1 text-2xs">(時給 ¥{yen(wage)})</span>}
          </span>
        </div>

        <Field label="メモ" htmlFor="shift-memo">
          <Textarea id="shift-memo" rows={2} value={form.memo} maxLength={500}
            onChange={(e) => set({ memo: e.target.value })} />
        </Field>

        <p className="text-2xs text-muted">
          時刻は営業日基準です。営業日境界({boundary}:00)より前の時刻は、その営業日の深夜(翌日の時刻)として保存されます。
          {isEdit && ' 時給は登録時のスナップショット(¥' + yen(shift.hourly_wage_snapshot) + ')が使われ、あとから時給を変えても変わりません。'}
        </p>
      </div>
    </Modal>
  );
}

// ── シフトタブ(週グリッド) ─────────────────────────
function ShiftsTab({ settings }) {
  const qc = useQueryClient();
  const push = useToastStore((s) => s.push);
  const weekStartDow = settings?.week_start_dow ?? 1;
  const boundary = settings?.business_day_boundary_hour ?? 9;

  const [weekStart, setWeekStart] = useState(() => weekStartOf(todayJST(), settings?.week_start_dow ?? 1));
  const [modal, setModal] = useState(null); // { shift } | { staffId, businessDate }
  const [copyResult, setCopyResult] = useState(null);

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => dayjs(weekStart).add(i, 'day').format(FMT)),
    [weekStart]
  );
  const weekEnd = days[6];
  const prevWeekStart = dayjs(weekStart).subtract(7, 'day').format(FMT);

  const staffQ = useQuery({ queryKey: ['v1', 'staff'], queryFn: api.getStaff });
  const staffAll = staffQ.data?.rows || [];

  const shiftsQ = useQuery({
    queryKey: ['v1', 'shifts', weekStart],
    queryFn: () => api.getShifts({ start: weekStart, end: weekEnd }),
  });
  const shifts = shiftsQ.data?.rows || [];

  // staff_id → business_date → シフト配列
  const byStaff = useMemo(() => {
    const m = new Map();
    for (const s of shifts) {
      if (!m.has(s.staff_id)) m.set(s.staff_id, new Map());
      const d = m.get(s.staff_id);
      if (!d.has(s.business_date)) d.set(s.business_date, []);
      d.get(s.business_date).push(s);
    }
    return m;
  }, [shifts]);

  // 表示するスタッフ: 有効なスタッフ + この週にシフトがあるスタッフ
  const staffRows = useMemo(
    () => staffAll.filter((s) => s.is_active || byStaff.has(s.id)),
    [staffAll, byStaff]
  );

  const totals = useMemo(() => {
    const perDay = new Map();
    let minutes = 0;
    let cost = 0;
    for (const s of shifts) {
      const cur = perDay.get(s.business_date) || { minutes: 0, cost: 0 };
      perDay.set(s.business_date, { minutes: cur.minutes + s.work_minutes, cost: cur.cost + s.labor_cost });
      minutes += s.work_minutes;
      cost += s.labor_cost;
    }
    return { perDay, minutes, cost };
  }, [shifts]);

  const staffTotal = (staffId) => {
    let minutes = 0;
    let cost = 0;
    for (const s of shifts) {
      if (s.staff_id !== staffId) continue;
      minutes += s.work_minutes;
      cost += s.labor_cost;
    }
    return { minutes, cost };
  };

  const copyM = useMutation({
    mutationFn: () => api.copyShiftsWeek(prevWeekStart, weekStart),
    onSuccess: (d) => {
      setCopyResult({ inserted: d?.inserted ?? 0, skipped: d?.skipped ?? 0 });
      qc.invalidateQueries({ queryKey: ['v1', 'shifts'] });
      qc.invalidateQueries({ queryKey: ['v1', 'labor'] });
      qc.invalidateQueries({ queryKey: ['v1', 'pl'] });
    },
    onError: (e) => { setCopyResult(null); push(`コピーに失敗しました: ${e.message}`, 'danger'); },
  });

  const moveWeek = (diff) => {
    setCopyResult(null);
    setWeekStart(dayjs(weekStart).add(diff * 7, 'day').format(FMT));
  };

  const cellFor = (staffId, date) => {
    const list = byStaff.get(staffId)?.get(date) || [];
    return (
      <div className="flex flex-col gap-1 min-w-24">
        {list.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setModal({ shift: s })}
            className="w-full rounded-md border border-primary-200 bg-primary-50 px-1.5 py-1 text-left text-2xs text-primary-800 hover:bg-primary-100 cursor-pointer"
          >
            <span className="block font-medium tabular-nums">
              {stampLabel(s.start_at, s.business_date)}–{stampLabel(s.end_at, s.business_date)}
            </span>
            <span className="block tabular-nums opacity-80">{fmtMinutes(s.work_minutes)} / ¥{yen(s.labor_cost)}</span>
          </button>
        ))}
        <button
          type="button"
          aria-label={`${date} のシフトを追加`}
          onClick={() => setModal({ staffId, businessDate: date })}
          className="w-full rounded-md border border-dashed border-line-strong px-1.5 py-0.5 text-2xs text-muted hover:bg-surface-hover cursor-pointer"
        >
          ＋
        </button>
      </div>
    );
  };

  const COLUMNS = [
    {
      key: 'name', header: 'スタッフ', width: 140,
      render: (r) => (r.__total ? (
        <span className="font-semibold text-heading">合計</span>
      ) : (
        <span className="inline-flex items-center gap-1.5">
          <span className="text-heading font-medium">{r.name}</span>
          {!r.is_active && <Badge size="sm">無効</Badge>}
        </span>
      )),
    },
    ...days.map((d) => ({
      key: d,
      header: (
        <span className="tabular-nums">
          {dayjs(d).format('M/D')}<span className="ml-1">({dowLabel(d)})</span>
        </span>
      ),
      render: (r) => {
        if (r.__total) {
          const t = totals.perDay.get(d) || { minutes: 0, cost: 0 };
          return (
            <span className="text-2xs tabular-nums text-body">
              {t.minutes > 0 ? `${fmtMinutes(t.minutes)} / ¥${yen(t.cost)}` : '—'}
            </span>
          );
        }
        return cellFor(r.id, d);
      },
    })),
    {
      key: '__week', header: '週計', align: 'right', width: 120,
      render: (r) => {
        const t = r.__total ? { minutes: totals.minutes, cost: totals.cost } : staffTotal(r.id);
        return (
          <span className={cn('tabular-nums text-2xs', r.__total ? 'font-semibold text-heading' : 'text-body')}>
            {t.minutes > 0 ? `${fmtMinutes(t.minutes)} / ¥${yen(t.cost)}` : '—'}
          </span>
        );
      },
    },
  ];

  const tableRows = staffRows.length > 0 ? [...staffRows, { id: '__total', __total: true }] : [];

  return (
    <div className="space-y-4">
      <Card dense>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Button variant="secondary" size="sm" iconOnly aria-label="前の週" onClick={() => moveWeek(-1)}>
              <svg viewBox="0 0 20 20" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5l-5 5 5 5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </Button>
            <Input
              size="sm" type="date" className="w-40" aria-label="表示する週(その日を含む週)"
              value={weekStart}
              onChange={(e) => e.target.value && setWeekStart(weekStartOf(e.target.value, weekStartDow))}
            />
            <Button variant="secondary" size="sm" iconOnly aria-label="次の週" onClick={() => moveWeek(1)}>
              <svg viewBox="0 0 20 20" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 5l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </Button>
          </div>
          <span className="text-sm text-body tabular-nums">
            {dayjs(weekStart).format('YYYY/M/D')}({dowLabel(weekStart)}) 〜 {dayjs(weekEnd).format('M/D')}({dowLabel(weekEnd)})
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => { setCopyResult(null); copyM.mutate(); }} loading={copyM.isPending}>
              先週をコピー
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setWeekStart(weekStartOf(todayJST(), weekStartDow))}>今週</Button>
            <ExportCsvButton report="shifts" params={{ start: weekStart, end: weekEnd }} className="h-8 px-3 text-xs" />
          </div>
        </div>
      </Card>

      {copyResult && (
        <Alert tone={copyResult.inserted > 0 ? 'success' : 'info'} title={`先週(${prevWeekStart}〜)から ${copyResult.inserted} 件コピー / ${copyResult.skipped} 件スキップ`}>
          同じスタッフ・同じ開始時刻のシフトが既にある分はスキップされます(何度実行しても重複しません)。
        </Alert>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile dense label="週の労働時間" value={`${fmtMinutes(totals.minutes)}`} sub={`${num(totals.minutes / 60, 1)} 時間`} />
        <StatTile dense label="週の人件費" value={`¥${yen(totals.cost)}`} sub={`${shifts.length} シフト`} />
        <StatTile dense label="出勤スタッフ" value={`${byStaff.size} 人`} sub={`登録 ${staffAll.length} 人`} />
        <StatTile dense label="平均時給(実績)" value={totals.minutes > 0 ? `¥${yen(totals.cost / (totals.minutes / 60))}` : '—'} sub="人件費 ÷ 労働時間" />
      </div>

      <Card title="週のシフト表" padded={false}>
        {shiftsQ.isError || staffQ.isError ? (
          <div className="p-3"><Alert tone="danger" title="シフトを取得できません">{(shiftsQ.error || staffQ.error)?.message}</Alert></div>
        ) : shiftsQ.isLoading || staffQ.isLoading ? (
          <div className="p-3"><Skeleton height={260} /></div>
        ) : staffRows.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted">スタッフが登録されていません。「スタッフ」タブから追加してください。</div>
        ) : (
          <DataTable
            columns={COLUMNS}
            rows={tableRows}
            rowKey={(r) => r.id}
            dense={false}
            className="border-0 rounded-none"
          />
        )}
      </Card>

      <p className="text-2xs text-muted">
        セルの「＋」で追加、シフトをクリックで編集・削除。実働 = (終了 − 開始) − 休憩、人件費 = 実働 × 登録時の時給。
        営業日境界({boundary}:00)より前の終了時刻(例: 26:00 = 深夜2時)は自動で翌日として保存されます。
      </p>

      {modal && (
        <ShiftModal
          shift={modal.shift}
          staffId={modal.staffId}
          businessDate={modal.businessDate}
          staffList={staffAll.filter((s) => s.is_active)}
          boundary={boundary}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

// ── スタッフ編集モーダル ───────────────────────────
function StaffEditModal({ staff, onClose }) {
  const qc = useQueryClient();
  const push = useToastStore((s) => s.push);
  const [err, setErr] = useState(null);
  const [form, setForm] = useState({
    name: staff.name,
    employment_type: staff.employment_type,
    hourly_wage: String(staff.hourly_wage ?? 0),
    monthly_salary: String(staff.monthly_salary ?? 0),
    is_active: staff.is_active !== false,
  });
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const wageChanged = Number(String(form.hourly_wage).trim()) !== staff.hourly_wage;

  const saveM = useMutation({
    mutationFn: () => api.updateStaff(staff.id, {
      name: form.name.trim(),
      employment_type: form.employment_type,
      hourly_wage: Number(String(form.hourly_wage).trim()),
      monthly_salary: Number(String(form.monthly_salary).trim()),
      is_active: form.is_active,
    }),
    onSuccess: () => {
      push('スタッフを更新しました', 'success');
      qc.invalidateQueries({ queryKey: ['v1', 'staff'] });
      onClose();
    },
    onError: (e) => setErr(e.message),
  });

  const canSave = form.name.trim() !== '' && !wageError(form.hourly_wage) && !salaryError(form.monthly_salary) && !saveM.isPending;

  return (
    <Modal
      title="スタッフを編集"
      onClose={onClose}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>キャンセル</Button>
          <Button onClick={() => saveM.mutate()} disabled={!canSave} loading={saveM.isPending}>保存</Button>
        </>
      )}
    >
      <div className="space-y-3">
        {err && <Alert tone="danger" title="保存に失敗しました">{err}</Alert>}
        <Field label="名前" htmlFor="staff-name" required>
          <Input id="staff-name" value={form.name} maxLength={50} invalid={form.name.trim() === ''}
            onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="雇用区分" htmlFor="staff-emp">
            <Select id="staff-emp" value={form.employment_type} options={EMPLOYMENT_OPTIONS}
              onChange={(e) => set({ employment_type: e.target.value })} />
          </Field>
          <Field label="時給" htmlFor="staff-wage" error={wageError(form.hourly_wage) ? `0〜${yen(MAX_WAGE)} の整数` : undefined}>
            <Input id="staff-wage" type="number" min={0} max={MAX_WAGE} prefix="¥" className="text-right"
              value={form.hourly_wage} invalid={wageError(form.hourly_wage)}
              onChange={(e) => set({ hourly_wage: e.target.value })} />
          </Field>
          <Field label="月給" htmlFor="staff-salary" error={salaryError(form.monthly_salary) ? `0〜${yen(MAX_SALARY)} の整数` : undefined}>
            <Input id="staff-salary" type="number" min={0} max={MAX_SALARY} prefix="¥" className="text-right"
              value={form.monthly_salary} invalid={salaryError(form.monthly_salary)}
              onChange={(e) => set({ monthly_salary: e.target.value })} />
          </Field>
        </div>
        <Field label="状態">
          <Segmented
            options={[{ value: true, label: '在籍' }, { value: false, label: '無効' }]}
            value={form.is_active}
            onChange={(v) => set({ is_active: v })}
          />
        </Field>
        {wageChanged && (
          <Alert tone="warning" title="時給の変更は履歴に残ります">
            新しい時給は「今日の営業日から有効」として時給履歴に記録され、以降に登録するシフトに反映されます。
            登録済みのシフトの人件費(登録時の時給スナップショット)は変わりません。
          </Alert>
        )}
      </div>
    </Modal>
  );
}

// ── スタッフ削除確認モーダル ───────────────────────
function DeleteStaffModal({ staff, onClose }) {
  const qc = useQueryClient();
  const push = useToastStore((s) => s.push);
  const [err, setErr] = useState(null);
  const delM = useMutation({
    mutationFn: () => api.deleteStaff(staff.id),
    onSuccess: () => {
      push('スタッフを削除しました', 'success');
      qc.invalidateQueries({ queryKey: ['v1', 'staff'] });
      onClose();
    },
    onError: (e) => setErr(e.message), // シフトあり(409)はサーバのメッセージをそのまま表示
  });
  return (
    <Modal
      title="スタッフを削除"
      size="sm"
      onClose={onClose}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>キャンセル</Button>
          <Button variant="danger" onClick={() => delM.mutate()} loading={delM.isPending}>削除する</Button>
        </>
      )}
    >
      <div className="space-y-3">
        {err && <Alert tone="danger" title="削除できません">{err}</Alert>}
        <p className="text-sm text-body">
          <span className="font-medium text-heading">{staff.name}</span> を削除します(時給履歴も一緒に消えます)。
        </p>
        <p className="text-xs text-muted">
          シフトが1件でもあるスタッフは削除できません。退職した場合は「無効」にしてください(過去の人件費は残ります)。
        </p>
      </div>
    </Modal>
  );
}

// ── スタッフタブ ─────────────────────────────────
function StaffTab() {
  const qc = useQueryClient();
  const push = useToastStore((s) => s.push);
  const [draft, setDraft] = useState({ name: '', employment_type: 'hourly', hourly_wage: '1200', monthly_salary: '0' });
  const [addErr, setAddErr] = useState(null);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const staffQ = useQuery({ queryKey: ['v1', 'staff'], queryFn: api.getStaff });
  const rows = staffQ.data?.rows || [];

  const createM = useMutation({
    mutationFn: () => api.createStaff({
      name: draft.name.trim(),
      employment_type: draft.employment_type,
      hourly_wage: Number(String(draft.hourly_wage).trim()),
      monthly_salary: Number(String(draft.monthly_salary).trim()),
    }),
    onSuccess: () => {
      setAddErr(null);
      push('スタッフを追加しました', 'success');
      setDraft({ name: '', employment_type: 'hourly', hourly_wage: '1200', monthly_salary: '0' });
      qc.invalidateQueries({ queryKey: ['v1', 'staff'] });
    },
    onError: (e) => setAddErr(e.message),
  });

  const toggleM = useMutation({
    mutationFn: (s) => api.updateStaff(s.id, { is_active: !s.is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['v1', 'staff'] }),
    onError: (e) => push(`更新に失敗しました: ${e.message}`, 'danger'),
  });

  const canCreate = draft.name.trim() !== '' && !wageError(draft.hourly_wage) && !salaryError(draft.monthly_salary) && !createM.isPending;
  const onDraftKeyDown = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (canCreate) createM.mutate();
  };

  const COLUMNS = [
    {
      key: 'name', header: '名前',
      render: (s) => (
        <span className="inline-flex items-center gap-1.5">
          <span className="text-heading font-medium">{s.name}</span>
          {!s.is_active && <Badge size="sm">無効</Badge>}
        </span>
      ),
    },
    {
      key: 'employment_type', header: '雇用区分', width: 110,
      render: (s) => <Badge tone={s.employment_type === 'owner' ? 'warning' : s.employment_type === 'monthly' ? 'info' : 'neutral'}>{EMPLOYMENT_LABELS[s.employment_type] || s.employment_type}</Badge>,
    },
    {
      key: 'current_wage', header: '時給(現在)', align: 'right', width: 120,
      render: (s) => (
        <span className="tabular-nums">
          ¥{yen(s.current_wage)}
          {s.current_wage !== s.hourly_wage && <span className="ml-1 text-2xs text-muted">(登録値 ¥{yen(s.hourly_wage)})</span>}
        </span>
      ),
    },
    { key: 'monthly_salary', header: '月給', align: 'right', width: 110, render: (s) => <span className="tabular-nums">{s.monthly_salary > 0 ? `¥${yen(s.monthly_salary)}` : '—'}</span> },
    { key: 'shift_count', header: 'シフト数', align: 'right', width: 90, render: (s) => <span className="tabular-nums">{s.shift_count} 件</span> },
    {
      key: 'ops', header: '操作', align: 'right', width: 200,
      render: (s) => (
        <span className="inline-flex items-center gap-1.5">
          <Button variant="secondary" size="sm" onClick={() => setEditing(s)}>編集</Button>
          <Button variant="secondary" size="sm" onClick={() => toggleM.mutate(s)}
            loading={toggleM.isPending && toggleM.variables?.id === s.id}>
            {s.is_active ? '無効化' : '有効化'}
          </Button>
          <Button variant="danger" size="sm" onClick={() => setDeleting(s)}>削除</Button>
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <Card title="スタッフ" padded={false}>
        <div className="px-3 py-2 border-b border-line bg-surface-sunken" onKeyDown={onDraftKeyDown}>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="名前" htmlFor="staff-new-name" className="w-44">
              <Input id="staff-new-name" size="sm" value={draft.name} maxLength={50} placeholder="例: 佐藤"
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
            </Field>
            <Field label="雇用区分" htmlFor="staff-new-emp" className="w-32">
              <Select id="staff-new-emp" size="sm" value={draft.employment_type} options={EMPLOYMENT_OPTIONS}
                onChange={(e) => setDraft((d) => ({ ...d, employment_type: e.target.value }))} />
            </Field>
            <Field label="時給" htmlFor="staff-new-wage" className="w-32">
              <Input id="staff-new-wage" size="sm" type="number" min={0} max={MAX_WAGE} prefix="¥" className="text-right"
                value={draft.hourly_wage} invalid={wageError(draft.hourly_wage)}
                onChange={(e) => setDraft((d) => ({ ...d, hourly_wage: e.target.value }))} />
            </Field>
            <Field label="月給" htmlFor="staff-new-salary" className="w-32">
              <Input id="staff-new-salary" size="sm" type="number" min={0} max={MAX_SALARY} prefix="¥" className="text-right"
                value={draft.monthly_salary} invalid={salaryError(draft.monthly_salary)}
                onChange={(e) => setDraft((d) => ({ ...d, monthly_salary: e.target.value }))} />
            </Field>
            <div className="leading-normal">
              <Button size="sm" onClick={() => createM.mutate()} disabled={!canCreate} loading={createM.isPending}>追加</Button>
            </div>
          </div>
          {addErr && <Alert tone="danger" className="mt-2">{addErr}</Alert>}
        </div>

        {staffQ.isError ? (
          <div className="p-3"><Alert tone="danger" title="スタッフを取得できません">{staffQ.error?.message}</Alert></div>
        ) : staffQ.isLoading ? (
          <div className="p-3"><Skeleton height={200} /></div>
        ) : (
          <DataTable
            columns={COLUMNS}
            rows={rows}
            rowKey={(s) => s.id}
            className="border-0 rounded-none"
            empty={<div className="py-10 text-center text-sm text-muted">スタッフはまだいません。上の行から追加できます。</div>}
          />
        )}
      </Card>

      <p className="text-2xs text-muted">
        {staffQ.data?.meta?.note || '時給を変更すると「今日の営業日から有効」として時給履歴に記録され、以降のシフトに反映されます。'}
        {' '}月給制・オーナーの人件費はシフトの時給計算とは別枠です(オーナー人件費をP&Lに含めるかは店舗設定で切り替えます)。
      </p>

      {editing && <StaffEditModal staff={editing} onClose={() => setEditing(null)} />}
      {deleting && <DeleteStaffModal staff={deleting} onClose={() => setDeleting(null)} />}
    </div>
  );
}

// ── 本体 ─────────────────────────────────────────
export default function ShiftsPage() {
  const [tab, setTab] = useState('shifts');
  const settingsQ = useQuery({ queryKey: ['v1', 'settings'], queryFn: api.getSettings });

  return (
    <div className="space-y-5">
      <Toolbar title="スタッフ・シフト" subtitle="シフトを入力して人件費を記録し、P&L・人時生産性の集計に反映する" />

      <Tabs tabs={TABS} activeId={tab} onChange={setTab} />

      {settingsQ.isError && <Alert tone="warning" title="店舗設定を取得できません">{settingsQ.error?.message}(週開始・営業日境界は既定値で表示します)</Alert>}

      {tab === 'shifts'
        ? (settingsQ.isLoading ? <Skeleton height={320} /> : <ShiftsTab settings={settingsQ.data} />)
        : <StaffTab />}
    </div>
  );
}
