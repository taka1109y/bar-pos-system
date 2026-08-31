// 複製元: client/src/utils/tz.js (本番 client を不変に保つため複製)
export const TZ = 'Asia/Tokyo';

export const todayJST = () =>
  new Date().toLocaleDateString('sv-SE', { timeZone: TZ });

// JST基準の「時」を返す（0-23）
export const hourInTZ = () =>
  Number(new Date().toLocaleTimeString('sv-SE', { timeZone: TZ }).slice(0, 2));
