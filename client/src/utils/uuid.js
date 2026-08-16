// 冪等キー生成: 会計・明細追加の1操作ごとに1つ生成し、タイムアウト自動リトライでも
// 同一キーを再送してサーバ側で二重処理を防ぐ。crypto.randomUUID 非対応(古いSafari)はフォールバック。
export function newIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `k-${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}
