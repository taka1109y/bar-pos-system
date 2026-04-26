const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// val を [min, max] にクランプして返す。パース失敗時は fallback を返す
function clampInt(val, min, max, fallback) {
  const parsed = parseInt(val, 10);
  if (isNaN(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

// YYYY-MM-DD 形式チェック。不正なら { status: 400, error } をthrowする
// グローバルエラーハンドラーに渡さず呼び出し元で即座に400を返すためプレーンオブジェクトをthrow
function assertDateFormat(val, fieldName = 'date') {
  if (!DATE_REGEX.test(val)) {
    throw { status: 400, error: `${fieldName} must be YYYY-MM-DD format` };
  }
}

module.exports = { clampInt, assertDateFormat };
