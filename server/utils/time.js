const TZ = process.env.TZ_REPORT || 'Asia/Tokyo';

function nowInTZ() {
  const now = new Date();
  return new Date(now.toLocaleString('en-US', { timeZone: TZ }));
}

function todayJST() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
}

// 時刻レンジ判定（32時間表記対応）
// startH < 24 && endH > 24: 日跨ぎ（例: 22〜29 → 22:00〜翌5:00）
// startH >= 24: 翌日以降（例: 25〜29 → 翌1:00〜翌5:00）
function isHourInRange(h, startH, endH) {
  if (startH < 24 && endH > 24) return h >= startH || h < (endH - 24);
  if (startH >= 24)              return h >= (startH - 24) && h < (endH - 24);
  return h >= startH && h < endH;
}

// 深夜時間帯判定（32時間表記対応）
function checkLateNight(startH, endH) {
  return isHourInRange(nowInTZ().getHours(), startH, endH);
}

module.exports = { TZ, nowInTZ, todayJST, checkLateNight, isHourInRange };
