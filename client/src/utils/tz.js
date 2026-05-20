export const TZ = 'Asia/Tokyo';

export const todayJST = () =>
  new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
