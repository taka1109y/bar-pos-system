'use strict';
// 営業日（business day）/ 暦日（calendar day）の変換ヘルパ
// - 営業日 = 「境界時刻(boundary_hour, 既定 9:00) より前の時刻は前日扱い」にした日付
//   例: boundary=9 のとき 8/30 03:00 JST の会計は営業日 8/29
// - SQL 側の式生成（dateExpr/rangeWhere/hour32Expr）と JS 側の日付計算（todayBusiness 等）を提供する
// - TZ の定義は server/utils/time.js と同じ（process.env.TZ_REPORT || 'Asia/Tokyo'）

const TZ = process.env.TZ_REPORT || 'Asia/Tokyo';
const MODES = new Set(['business', 'calendar']);
const DEFAULT_BOUNDARY = 9;

function assertMode(mode) {
  if (!MODES.has(mode)) throw new Error(`day_mode は 'business' か 'calendar' を指定してください: ${mode}`);
  return mode;
}

function assertBoundary(boundary) {
  const b = boundary === undefined || boundary === null ? DEFAULT_BOUNDARY : Number(boundary);
  if (!Number.isInteger(b) || b < 0 || b > 12) {
    throw new Error(`business_day_boundary_hour は 0〜12 の整数を指定してください: ${boundary}`);
  }
  return b;
}

// SQL 文字列リテラル（TZ 名など、信頼できる設定値のみに使う）
function sqlLiteral(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

// timestamptz 列を TZ のローカル時刻（timestamp without time zone）に変換した式
function localTsExpr(col, { tz = TZ } = {}) {
  return `(${col} AT TIME ZONE ${sqlLiteral(tz)})`;
}

// 営業日/暦日の日付式（::date）
function dateExpr(mode, col, { tz = TZ, boundary = DEFAULT_BOUNDARY } = {}) {
  assertMode(mode);
  const b = assertBoundary(boundary);
  const local = localTsExpr(col, { tz });
  if (mode === 'calendar' || b === 0) return `${local}::date`;
  return `(${local} - INTERVAL '${b} hours')::date`;
}

// 期間フィルタ WHERE 句。startParam/endParam は呼び出し側のプレースホルダ番号（既定 $1/$2）
function rangeWhere(mode, col, { startParam = '$1', endParam = '$2', ...opts } = {}) {
  return `${dateExpr(mode, col, opts)} BETWEEN ${startParam}::date AND ${endParam}::date`;
}

// 32時間表記の時（境界より前の時刻は +24。例: boundary=9 なら 03:00 → 27）
function hour32Expr(col, { tz = TZ, boundary = DEFAULT_BOUNDARY } = {}) {
  const b = assertBoundary(boundary);
  const h = `EXTRACT(HOUR FROM ${localTsExpr(col, { tz })})::int`;
  if (b === 0) return h;
  return `(${h} + CASE WHEN ${h} < ${b} THEN 24 ELSE 0 END)`;
}

// ---- JS 側 ----

// Date を TZ のローカル成分に分解する
function localParts(date, tz = TZ) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const p = {};
  for (const { type, value } of fmt.formatToParts(date)) p[type] = value;
  return {
    year: Number(p.year), month: Number(p.month), day: Number(p.day),
    hour: Number(p.hour) % 24, minute: Number(p.minute),
  };
}

function ymd({ year, month, day }) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// 任意の時刻が属する営業日（YYYY-MM-DD）
function businessDateOf(date, boundary = DEFAULT_BOUNDARY, tz = TZ) {
  const b = assertBoundary(boundary);
  const shifted = new Date(date.getTime() - b * 3600 * 1000);
  return ymd(localParts(shifted, tz));
}

// 任意の時刻が属する暦日（YYYY-MM-DD）
function calendarDateOf(date, tz = TZ) {
  return ymd(localParts(date, tz));
}

// 今日の営業日
function todayBusiness(boundary = DEFAULT_BOUNDARY, now = new Date(), tz = TZ) {
  return businessDateOf(now, boundary, tz);
}

// 今日の暦日（server/utils/time.js の todayJST と同じ結果）
function todayCalendar(now = new Date(), tz = TZ) {
  return calendarDateOf(now, tz);
}

// 32時間表記の時（JS 側）
function hour32Of(date, boundary = DEFAULT_BOUNDARY, tz = TZ) {
  const b = assertBoundary(boundary);
  const { hour } = localParts(date, tz);
  return hour < b ? hour + 24 : hour;
}

// モードに応じた日付
function dateOf(mode, date, boundary = DEFAULT_BOUNDARY, tz = TZ) {
  assertMode(mode);
  return mode === 'business' ? businessDateOf(date, boundary, tz) : calendarDateOf(date, tz);
}

module.exports = {
  TZ, MODES, DEFAULT_BOUNDARY,
  assertMode, assertBoundary,
  dateExpr, rangeWhere, hour32Expr, localTsExpr,
  localParts, businessDateOf, calendarDateOf, todayBusiness, todayCalendar, hour32Of, dateOf,
};
