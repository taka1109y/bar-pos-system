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

// ============================================================================
// Phase 1 追加分: パラメータ化 SQL 式・粒度バケット・日付演算・表示ラベル
// - 既存 API（上記）は変更しない
// - bardb クエリのプレースホルダ順は [start, end, TZ, B] を厳守する。
//   $3=TZ / $4=B(実効境界時) を参照するパラメータ化式を使い、
//   day_mode=calendar のときは B=0 を渡す（暦日集計＝posDefs.RANGE_FILTER と同値になる）
// ============================================================================

const GRANULARITIES = new Set(['day', 'week', 'month', 'fiscal_year']);
const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

function assertGranularity(g) {
  if (!GRANULARITIES.has(g)) {
    throw new Error(`granularity は day / week / month / fiscal_year のいずれかを指定してください: ${g}`);
  }
  return g;
}

function assertIntIn(v, min, max, name) {
  if (!Number.isInteger(v) || v < min || v > max) {
    throw new Error(`${name} は ${min}〜${max} の整数を指定してください: ${v}`);
  }
  return v;
}

// 営業日/暦日の日付式（パラメータ化版）。B=0 なら暦日と同じ
function dateExprParam(col, { tzParam = '$3', boundaryParam = '$4' } = {}) {
  return `((${col} AT TIME ZONE ${tzParam}) - make_interval(hours => ${boundaryParam}::int))::date`;
}

// sargable な期間フィルタ（col のインデックスが効く形）:
//   col >= (start + B時間) AT TIME ZONE tz AND col < ((end+1日) + B時間) AT TIME ZONE tz
// dateExprParam(col) BETWEEN start AND end と同値で、B=0 なら posDefs.RANGE_FILTER（暦日）と同値
function rangeWhereParam(col, { startParam = '$1', endParam = '$2', tzParam = '$3', boundaryParam = '$4' } = {}) {
  return `(${col} >= (${startParam}::date::timestamp + make_interval(hours => ${boundaryParam}::int)) AT TIME ZONE ${tzParam}` +
    ` AND ${col} < ((${endParam}::date + 1)::timestamp + make_interval(hours => ${boundaryParam}::int)) AT TIME ZONE ${tzParam})`;
}

// 32時間表記の時（パラメータ化版）。B=0 なら 0..23 のまま
function hour32ExprParam(col, { tzParam = '$3', boundaryParam = '$4' } = {}) {
  const h = `EXTRACT(HOUR FROM (${col} AT TIME ZONE ${tzParam}))::int`;
  return `(${h} + CASE WHEN ${h} < ${boundaryParam}::int THEN 24 ELSE 0 END)`;
}

// モードに応じた実効境界時（SQL の $4 に渡す値）。calendar は常に 0
function effectiveBoundary(mode, boundary) {
  assertMode(mode);
  return mode === 'calendar' ? 0 : assertBoundary(boundary);
}

// 粒度バケットの SQL 式（dexpr は dateExpr/dateExprParam の結果＝::date 式）
// week は week_start_dow 起点の週初日、fiscal_year は fiscal_year_start_month 起点の年度初日
function bucketExpr(granularity, dexpr, { weekStartDow = 1, fiscalYearStartMonth = 1 } = {}) {
  assertGranularity(granularity);
  const w = assertIntIn(weekStartDow, 0, 6, 'week_start_dow');
  const m = assertIntIn(fiscalYearStartMonth, 1, 12, 'fiscal_year_start_month');
  switch (granularity) {
    case 'day':
      return dexpr;
    case 'week':
      // EXTRACT(DOW)=0(日)..6(土)。(dow - 起点 + 7) % 7 日戻すと週初日になる
      return `(${dexpr} - ((EXTRACT(DOW FROM ${dexpr})::int - ${w} + 7) % 7))`;
    case 'month':
      return `date_trunc('month', ${dexpr})::date`;
    case 'fiscal_year':
      if (m === 1) return `date_trunc('year', ${dexpr})::date`;
      return `(date_trunc('year', ${dexpr} - make_interval(months => ${m - 1})) + make_interval(months => ${m - 1}))::date`;
    default:
      throw new Error(`unreachable granularity: ${granularity}`);
  }
}

// ---- JS 側: YYYY-MM-DD 文字列の暦計算（UTC 基準の純粋計算。TZ 変換は関与しない）----

function pad2(n) {
  return String(n).padStart(2, '0');
}

// YYYY-MM-DD → UTC ミリ秒。形式不正・実在しない日付（2/30 等）は null
function parseYmd(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd));
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(t);
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) {
    return null;
  }
  return t;
}

function fromUtcMs(t) {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

// リクエスト入力の日付検証。不正なら {status, error} を throw（server/utils/validate.js と同じ流儀）
function assertYmd(value, name = 'date') {
  if (typeof value !== 'string' || parseYmd(value) === null) {
    throw { status: 400, error: `${name} は YYYY-MM-DD 形式の実在する日付を指定してください` };
  }
  return value;
}

function addDays(ymd, n) {
  return fromUtcMs(parseYmd(ymd) + n * 86400000);
}

// a から b までの日数差（b - a）。同日なら 0
function diffDays(a, b) {
  return Math.round((parseYmd(b) - parseYmd(a)) / 86400000);
}

// 曜日 0=日..6=土
function dowOf(ymd) {
  return new Date(parseYmd(ymd)).getUTCDay();
}

// n 年前/後の同日付。存在しない日（2/29 等）はその月の末日へ丸める
function addYears(ymd, n) {
  const [y, mo, d] = ymd.split('-').map(Number);
  const ty = y + n;
  const lastDay = new Date(Date.UTC(ty, mo, 0)).getUTCDate();
  return `${ty}-${pad2(mo)}-${pad2(Math.min(d, lastDay))}`;
}

// ymd が属する粒度バケットの開始日（bucketExpr と同じ結果になる JS 実装）
function bucketStartOf(granularity, ymd, { weekStartDow = 1, fiscalYearStartMonth = 1 } = {}) {
  assertGranularity(granularity);
  switch (granularity) {
    case 'day':
      return ymd;
    case 'week': {
      const back = ((dowOf(ymd) - weekStartDow) % 7 + 7) % 7;
      return addDays(ymd, -back);
    }
    case 'month':
      return `${ymd.slice(0, 7)}-01`;
    case 'fiscal_year': {
      const y = Number(ymd.slice(0, 4));
      const mo = Number(ymd.slice(5, 7));
      const fy = mo >= fiscalYearStartMonth ? y : y - 1;
      return `${fy}-${pad2(fiscalYearStartMonth)}-01`;
    }
    default:
      throw new Error(`unreachable granularity: ${granularity}`);
  }
}

// バケット開始日 → 次のバケット開始日
function nextBucketStart(granularity, ymd, { fiscalYearStartMonth = 1 } = {}) {
  assertGranularity(granularity);
  switch (granularity) {
    case 'day':
      return addDays(ymd, 1);
    case 'week':
      return addDays(ymd, 7);
    case 'month': {
      const y = Number(ymd.slice(0, 4));
      const mo = Number(ymd.slice(5, 7));
      return mo === 12 ? `${y + 1}-01-01` : `${y}-${pad2(mo + 1)}-01`;
    }
    case 'fiscal_year':
      return `${Number(ymd.slice(0, 4)) + 1}-${ymd.slice(5)}`;
    default:
      throw new Error(`unreachable granularity: ${granularity}`);
  }
}

// [start, end] を覆う全バケット開始日（0埋め用）。先頭は start を含むバケットの開始日（start より前になり得る）
function enumerateBuckets(granularity, start, end, opts = {}, maxBuckets = 4000) {
  const out = [];
  let cur = bucketStartOf(granularity, start, opts);
  while (cur <= end) {
    out.push(cur);
    if (out.length > maxBuckets) {
      throw { status: 400, error: `期間が長すぎます（バケット数の上限 ${maxBuckets} を超えました）` };
    }
    cur = nextBucketStart(granularity, cur, opts);
  }
  return out;
}

// 表示ラベル。day "8/30(土)" / week "8/25週" / month "2026-08" / fiscal_year "2026年度"
function label(granularity, periodStart) {
  assertGranularity(granularity);
  const mo = Number(periodStart.slice(5, 7));
  const d = Number(periodStart.slice(8, 10));
  switch (granularity) {
    case 'day':
      return `${mo}/${d}(${DOW_LABELS[dowOf(periodStart)]})`;
    case 'week':
      return `${mo}/${d}週`;
    case 'month':
      return periodStart.slice(0, 7);
    case 'fiscal_year':
      return `${periodStart.slice(0, 4)}年度`;
    default:
      throw new Error(`unreachable granularity: ${granularity}`);
  }
}

// 32時間表記の時ラベル。"21時" / "26時(翌2時)"
function hour32Label(h) {
  return h < 24 ? `${h}時` : `${h}時(翌${h - 24}時)`;
}

Object.assign(module.exports, {
  GRANULARITIES, DOW_LABELS,
  assertGranularity,
  dateExprParam, rangeWhereParam, hour32ExprParam, effectiveBoundary, bucketExpr,
  assertYmd, addDays, diffDays, dowOf, addYears,
  bucketStartOf, nextBucketStart, enumerateBuckets, label, hour32Label,
});
