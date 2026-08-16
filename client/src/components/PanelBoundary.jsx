import { Component } from 'react';

// パネル単位のエラーバウンダリ。1画面(view)の描画例外を局所化し、
// 全レジのリロード(会計途中の入力消失)を防ぐ。再試行はこのパネルのみ再マウントする。
export default class PanelBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, key: 0 };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('[PanelBoundary]', this.props.name || '', error, info);
  }
  retry = () => this.setState((s) => ({ error: null, key: s.key + 1 }));
  render() {
    if (this.state.error) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-10 text-center">
          <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center text-2xl">⚠</div>
          <div>
            <p className="text-base font-bold text-slate-900">この画面でエラーが発生しました</p>
            <p className="text-sm text-slate-500 mt-1">他の画面や会計は継続できます。再試行してください。</p>
          </div>
          <button
            onClick={this.retry}
            className="inline-flex items-center justify-center h-10 px-5 text-sm font-medium bg-primary-500 text-white rounded-lg hover:bg-primary-700 cursor-pointer"
          >
            この画面を再読み込み
          </button>
        </div>
      );
    }
    // key を変えると子を再マウントして状態をリセットできる
    return <div key={this.state.key} className="contents">{this.props.children}</div>;
  }
}
