import { hourInTZ } from './tz';

// 時刻レンジ判定（32時間表記対応）
// startH < 24 && endH > 24: 日跨ぎ（例: 22〜29 → 22:00〜翌5:00）
// startH >= 24: 翌日以降（例: 25〜29 → 翌1:00〜翌5:00）
// server/utils/time.js の isHourInRange と同じロジック。変更時は両方合わせること
export function isHourInRange(h, startH, endH) {
  if (startH < 24 && endH > 24) return h >= startH || h < (endH - 24);
  if (startH >= 24)             return h >= (startH - 24) && h < (endH - 24);
  return h >= startH && h < endH;
}

// 深夜時間帯判定（32時間表記対応）
export function isLateNightNow(startH, endH) {
  return isHourInRange(hourInTZ(), startH, endH);
}
