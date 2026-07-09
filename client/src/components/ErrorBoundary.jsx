import { Component } from 'react';

// アプリ全体のエラーバウンダリ。
// レンダリング中の例外を捕捉し、真っ白画面を防ぐ。
// 顧客端末が無人でも復帰できるよう、数秒後に自動リロード（注文状態はサーバー保持のため失われない）。
// ただしクラッシュループを避けるため、短時間に連続して落ちる場合は手動リロード表示に切替える。

const WINDOW_MS = 60_000;    // クラッシュループ判定ウィンドウ
const MAX_RELOADS = 3;       // ウィンドウ内の自動リロード上限
const RELOAD_DELAY_MS = 3000;

function FullScreen({ children }) {
  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-4 bg-white text-slate-500">
      {children}
    </div>
  );
}

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, giveUp: false };
    this._timer = null;
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info);

    let giveUp = false;
    try {
      const now = Date.now();
      const raw = sessionStorage.getItem('eb_reloads');
      const hist = (raw ? JSON.parse(raw) : []).filter((t) => now - t < WINDOW_MS);
      if (hist.length >= MAX_RELOADS) {
        giveUp = true;
      } else {
        hist.push(now);
        sessionStorage.setItem('eb_reloads', JSON.stringify(hist));
      }
    } catch (_) {
      // sessionStorage が使えなくても自動リロードは試みる
    }

    if (giveUp) {
      this.setState({ giveUp: true });
    } else {
      this._timer = setTimeout(() => window.location.reload(), RELOAD_DELAY_MS);
    }
  }

  componentWillUnmount() {
    if (this._timer) clearTimeout(this._timer);
  }

  handleManualReload = () => {
    try { sessionStorage.removeItem('eb_reloads'); } catch (_) { /* noop */ }
    window.location.reload();
  };

  render() {
    if (this.state.giveUp) {
      return (
        <FullScreen>
          <button
            onClick={this.handleManualReload}
            className="flex flex-col items-center gap-2 cursor-pointer"
          >
            <span className="text-lg font-bold text-slate-700">一時的な問題が発生しました</span>
            <span className="text-sm text-slate-400">画面をタップして再読み込み</span>
          </button>
        </FullScreen>
      );
    }
    if (this.state.hasError) {
      return (
        <FullScreen>
          <div className="w-10 h-10 border-4 border-slate-200 border-t-primary-500 rounded-full animate-spin" />
          <span className="text-sm text-slate-400">読み込み中…</span>
        </FullScreen>
      );
    }
    return this.props.children;
  }
}
