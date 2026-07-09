// グローバルエラーハンドラ。
// 未捕捉のエラー / Promise 拒否を握りつぶさずログする（UIは壊さない）。
// レンダリング中の例外は ErrorBoundary が担当する。

export function registerGlobalErrorHandlers() {
  if (typeof window === 'undefined' || window.__globalErrHandlersRegistered) return;
  window.__globalErrHandlersRegistered = true;

  window.addEventListener('error', (event) => {
    console.error('[global error]', event.error || event.message);
  });

  window.addEventListener('unhandledrejection', (event) => {
    console.error('[unhandledrejection]', event.reason);
  });
}
