// 日時表示ヘルパ(JST 固定)。サーバの ISO 文字列(TIMESTAMPTZ)を閲覧端末のTZに依らず JST で表示する。
import { TZ } from './tz';

const DT = new Intl.DateTimeFormat('ja-JP', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
});
const D = new Intl.DateTimeFormat('ja-JP', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

// "2026/08/30 21:05" 形式。null/不正値は '—'。
export function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : DT.format(d);
}

// "2026/08/30" 形式。
export function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : D.format(d);
}

// "YYYY-MM-DD" → "M/D"(チャート軸用)
export function shortDate(ymd) {
  if (!ymd || typeof ymd !== 'string') return '';
  const [, m, d] = ymd.split('-');
  return m && d ? `${Number(m)}/${Number(d)}` : ymd;
}
