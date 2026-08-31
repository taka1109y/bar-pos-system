'use strict';
// console ベースの最小ロガー（pino は使わない）
// 注意: 接続文字列・パスワード等の秘密情報は絶対に渡さないこと（公開リポジトリ・ログ保存のため）

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const defaultLevel = process.env.NODE_ENV === 'production' ? 'info' : 'debug';
const threshold = LEVELS[String(process.env.LOG_LEVEL || defaultLevel).toLowerCase()] ?? LEVELS.info;

function format(level, msg, extra) {
  let line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${msg}`;
  if (extra !== undefined) {
    try { line += ' ' + JSON.stringify(extra); } catch { line += ' [unserializable]'; }
  }
  return line;
}

function make(level) {
  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  return (msg, extra) => {
    if (LEVELS[level] < threshold) return;
    sink(format(level, msg, extra));
  };
}

// Error を安全に要約する（スタックや接続情報は含めない）
function errInfo(err) {
  if (!err) return null;
  return { name: err.name, message: err.message, code: err.code };
}

module.exports = {
  debug: make('debug'),
  info: make('info'),
  warn: make('warn'),
  error: make('error'),
  errInfo,
};
