import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import socket from '../socket';
import usePriceStore from '../store/usePriceStore';
import { useConnStore } from '../store/useConnStore';
import PriceRow from '../components/board/PriceRow';
import CategoryHeaderRow from '../components/board/CategoryHeaderRow';
import { yen, num } from '../utils/format';
import { priceDisplay } from '../utils/priceTone';
import { playNotification } from '../utils/audioAlert';

const HEADER_ROW_HEIGHT_PX = 44; // 列見出し行(thead)の概算高さ
const ROW_HEIGHT_PX        = 60; // カテゴリ見出し行・商品行(スパークライン込み) 共通の概算高さ
const PAGE_INTERVAL_MS     = 10_000; // ページ自動切替の間隔(固定10秒)

// カテゴリの並び順(サーバーのORDER BYで既に保証済み)を維持したままグルーピングする
function groupByCategory(items) {
  const groups = new Map();
  for (const item of items) {
    const key = item.category_id ?? 'uncategorized';
    if (!groups.has(key)) {
      groups.set(key, { categoryId: key, categoryName: item.category_name ?? '', items: [] });
    }
    groups.get(key).items.push(item);
  }
  return [...groups.values()];
}

// 各ページを可能な限り「詰めて」埋める。カテゴリ境界でページを切らず、
// 余地が尽きたらカテゴリを跨いで分割し、続きページには「続き」見出しを出す。
// (見出し1行 + 最低1商品 が入らない場合のみ改ページ＝見出しだけがページ末尾に残らない)
function buildPages(categoryGroups, maxRows) {
  const pages = [];
  let page = [];
  let used = 0; // 現ページで使用済みの行数(見出し+商品)

  const flush = () => { if (page.length > 0) pages.push(page); page = []; used = 0; };

  for (const group of categoryGroups) {
    let idx = 0;
    let continued = false;
    while (idx < group.items.length) {
      // 見出し1行 + 最低1商品 の余地がなければ改ページ
      if (used >= maxRows - 1 && page.length > 0) flush();
      const avail = maxRows - used - 1; // 見出し分を差し引いた残り
      if (avail <= 0) { flush(); continue; }
      const take = Math.min(avail, group.items.length - idx);
      page.push({
        categoryId:   group.categoryId,
        categoryName: group.categoryName,
        items:        group.items.slice(idx, idx + take),
        continued,
      });
      used += 1 + take;
      idx += take;
      continued = true;
      if (idx < group.items.length) flush(); // まだ残る=次ページへ続く
    }
  }
  flush();
  return pages.length > 0 ? pages : [[]];
}

// 上部の流れるティッカー(取引所ボード風・銘柄と寄り付き比%が横に流れる)
function Ticker({ prices }) {
  if (prices.length === 0) return null;
  const items = [...prices, ...prices];
  return (
    <div className="board-mono flex-shrink-0 overflow-hidden border-y border-slate-700/40 py-1.5 mb-3">
      <div className="flex whitespace-nowrap" style={{ animation: 'ticker 26s linear infinite' }}>
        {items.map((item, i) => {
          // 中心(寄り付き)比。engine_off/時価/暴落は色/％を出さない(暴落は CRASH)。
          const disp = priceDisplay(item);
          const isUp = disp.tone === 'up', isDown = disp.tone === 'down';
          const pctColor = disp.crashed ? 'text-red-400' : isUp ? 'text-[#1fe08a]' : isDown ? 'text-[#ff415e]' : 'text-slate-500';
          const centerPct = Number(item.center_pct) || 0;
          const pctDisplay = disp.crashed
            ? 'CRASH'
            : (disp.variable && (isUp || isDown))
              ? `${isUp ? '▲' : '▼'}${num(Math.abs(centerPct), 1)}%`
              : '';
          return (
            <span key={i} className="inline-flex items-center gap-3 text-[1.375rem]">
              <span className="text-slate-300 font-medium tracking-wide">{item.name}</span>
              <span className="text-[#ffd36b] font-semibold tabular-nums">¥{yen(item.current_price)}</span>
              {pctDisplay && <span className={`font-semibold tabular-nums ${pctColor}`}>{pctDisplay}</span>}
              {/* 塊同士の区切り(前の価格と次の商品名がくっつかないように) */}
              <span className="mx-8 text-slate-600" aria-hidden="true">・</span>
            </span>
          );
        })}
      </div>
      <style>{`@keyframes ticker { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }`}</style>
    </div>
  );
}

function Clock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="board-mono text-[#ffd36b] text-[2.875rem] font-semibold tracking-wider tabular-nums">
      {time.toLocaleTimeString('ja-JP')}
    </span>
  );
}

export default function BoardPage() {
  const { initPrices, updatePrices, getAllPrices } = usePriceStore();
  const prices = getAllPrices();

  const rootRef      = useRef(null);
  const tableAreaRef = useRef(null);
  const [maxRows, setMaxRows] = useState(8);
  const [pageIndex, setPageIndex] = useState(0);

  // 切断/スタール検知(お客様が古い価格を「ライブ」と誤認しないための表示)
  const connected = useConnStore((s) => s.connected);
  const [stale, setStale] = useState(false);
  const lastUpdateRef = useRef(Date.now());

  // 初回取得 + 20秒ポーリング保険(broadcast取りこぼし・emit失敗でも価格を最新化)
  useEffect(() => {
    const fetchPrices = () => api.getPrices()
      .then((p) => { initPrices(p); lastUpdateRef.current = Date.now(); })
      .catch(console.error);
    fetchPrices();
    const id = setInterval(fetchPrices, 20_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const handle = ({ items }) => { updatePrices(items); lastUpdateRef.current = Date.now(); };
    socket.on('prices:updated', handle);
    return () => socket.off('prices:updated', handle);
  }, []);

  // 初回取得の失敗やソケット切断に対する自己修復(TablePage.jsxと同じパターン)
  useEffect(() => {
    const handlePricesSync = ({ items }) => { initPrices(items); lastUpdateRef.current = Date.now(); };
    const handleReconnect  = () => { api.getPrices().then((p) => { initPrices(p); lastUpdateRef.current = Date.now(); }).catch(console.error); };
    socket.on('prices:sync', handlePricesSync);
    socket.on('connect',     handleReconnect);
    return () => {
      socket.off('prices:sync', handlePricesSync);
      socket.off('connect',     handleReconnect);
    };
  }, []);

  // 45秒以上更新が無ければスタール(サーバ応答なし)とみなす
  useEffect(() => {
    const id = setInterval(() => setStale(Date.now() - lastUpdateRef.current > 45_000), 5_000);
    return () => clearInterval(id);
  }, []);
  const priceOffline = !connected || stale;

  // 暴落演出(フェーズ3): crash:started/ended と 初期状態(crash_ends_at)から暴落中フラグ・終了時刻を管理
  const [crashEndsAt, setCrashEndsAt] = useState(null); // ISO文字列 or null
  const [crashRemaining, setCrashRemaining] = useState(0); // 残り秒
  useEffect(() => {
    // 初期状態の復元（リロード時に暴落中なら演出を再開）
    api.getSystemSettings()
      .then((s) => { if (s?.crash_ends_at && new Date(s.crash_ends_at).getTime() > Date.now()) setCrashEndsAt(s.crash_ends_at); })
      .catch(() => {});
    const handleStarted = (data) => {
      setCrashEndsAt(data?.endsAt ?? null);
      try { playNotification(); } catch { /* 音源はプレースホルダ */ }
    };
    const handleEnded = () => setCrashEndsAt(null);
    socket.on('crash:started', handleStarted);
    socket.on('crash:ended',   handleEnded);
    return () => {
      socket.off('crash:started', handleStarted);
      socket.off('crash:ended',   handleEnded);
    };
  }, []);

  // 開場演出(Phase6-3): 寄り付き(market:open)を数秒間オーバーレイ表示(音源はプレースホルダ)
  const [marketOpenShow, setMarketOpenShow] = useState(false);
  useEffect(() => {
    let t = null;
    const handleOpen = () => {
      setMarketOpenShow(true);
      try { playNotification(); } catch { /* 音源はプレースホルダ */ }
      if (t) clearTimeout(t);
      t = setTimeout(() => setMarketOpenShow(false), 6000);
    };
    socket.on('market:open', handleOpen);
    return () => { socket.off('market:open', handleOpen); if (t) clearTimeout(t); };
  }, []);

  // 残り時間カウントダウン
  useEffect(() => {
    if (!crashEndsAt) { setCrashRemaining(0); return; }
    const update = () => {
      const rem = Math.max(0, Math.ceil((new Date(crashEndsAt).getTime() - Date.now()) / 1000));
      setCrashRemaining(rem);
      if (rem <= 0) setCrashEndsAt(null); // 保険（サーバ解除が届かない場合）
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [crashEndsAt]);
  const crashActive = !!crashEndsAt && crashRemaining > 0;
  const crashMMSS = `${String(Math.floor(crashRemaining / 60)).padStart(2, '0')}:${String(crashRemaining % 60).padStart(2, '0')}`;

  // Phase7: 期(15分)カウントダウンは廃止（時間減衰なし。価格は注文シーソーでリアルタイム更新）。

  const hasData = prices.length > 0;

  // 表示エリアの実高さと「実際の行高(DOM実測)」から、1ページに収まる行数を計算する。
  // 固定の概算値ではなく実測にすることで、下の凡例直前まで余白なく詰め、かつはみ出しも防ぐ。
  // 行高は最も背の高い「商品行(.board-item-row)」を基準にする(カテゴリ見出しは低いため安全側)。
  const measureMaxRows = useCallback(() => {
    const el = tableAreaRef.current;
    if (!el) return;
    const thead   = el.querySelector('thead');
    const itemRow = el.querySelector('tr.board-item-row');
    // getBoundingClientRect は小数精度。offsetHeight(整数丸め)だと実際より小さく出て
    // 行数を過大評価し、最後の行が見切れる原因になる。
    const headH = thead?.getBoundingClientRect().height   || HEADER_ROW_HEIGHT_PX;
    const rowH  = itemRow?.getBoundingClientRect().height || ROW_HEIGHT_PX;
    if (rowH <= 0) return;
    const available = el.clientHeight - headH;
    const next = Math.max(Math.floor((available - 4) / rowH), 3); // -4px は端数・境界線の安全マージン
    setMaxRows((prev) => (prev === next ? prev : next));
  }, []);

  // 可視領域の高さをJSで実測してルートに適用する。
  // 100vh は URLバー/ナビゲーションバーの領域を含むため、Android Chrome 等では
  // 実際に見えている領域より大きくなり下端(最終行・凡例)が見切れる。
  // visualViewport はバーの表示状態を反映した「実際に見えている高さ」を返すので、
  // これを px で上書きすることで svh 非対応ブラウザも含め確実に画面内へ収める。
  const applyViewportHeight = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const h = window.visualViewport?.height ?? window.innerHeight;
    if (h > 0) root.style.height = `${Math.floor(h)}px`;
    measureMaxRows(); // 高さが変わったら収まる行数も再計算する
  }, [measureMaxRows]);

  // ボード表示中だけ PWA マニフェストをボード専用へ差し替える。
  // 既定の manifest.json は start_url='/'(POS画面)・standalone のため、そのまま
  // 「ホーム画面に追加」するとPOSが開いてしまう。board-manifest.json は
  // start_url='/board'・display=fullscreen・横向き固定。
  // ※Chrome のPWAインストールは安全なコンテキスト(HTTPS/localhost)が必要。HTTPのLAN配信では
  //   端末側で chrome://flags の「Insecure origins treated as secure」に当該オリジンを
  //   登録する必要がある(未設定でも下の「全画面」ボタンで全画面化できる)。
  useEffect(() => {
    const link = document.querySelector('link[rel="manifest"]');
    if (!link) return;
    const prev = link.getAttribute('href');
    link.setAttribute('href', '/board-manifest.json');
    return () => { if (prev) link.setAttribute('href', prev); };
  }, []);

  // 全画面表示(Fullscreen API)。HTTPS不要のため現行のHTTP配信でも動作する。
  // 仕様上ユーザー操作が必要なため、ボタンのタップで全画面化する。
  // PWA(ホーム画面のアイコン)から起動した場合は既に全画面なのでボタンは出さない。
  const [isStandalone] = useState(() => {
    try { return window.matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches; }
    catch { return false; }
  });
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    } else {
      const el = document.documentElement;
      (el.requestFullscreen?.({ navigationUI: 'hide' }) ?? Promise.reject()).catch(() => {
        el.webkitRequestFullscreen?.(); // 旧WebKit系の保険
      });
    }
  }, []);

  useEffect(() => {
    applyViewportHeight();
    const vv = window.visualViewport;
    window.addEventListener('resize', applyViewportHeight);
    window.addEventListener('orientationchange', applyViewportHeight);
    vv?.addEventListener('resize', applyViewportHeight);
    vv?.addEventListener('scroll', applyViewportHeight); // バーの開閉でオフセットが変わる端末向け
    return () => {
      window.removeEventListener('resize', applyViewportHeight);
      window.removeEventListener('orientationchange', applyViewportHeight);
      vv?.removeEventListener('resize', applyViewportHeight);
      vv?.removeEventListener('scroll', applyViewportHeight);
    };
  }, [applyViewportHeight]);

  useEffect(() => {
    const area = tableAreaRef.current;
    if (!area) return;
    measureMaxRows();
    const ro = new ResizeObserver(measureMaxRows);
    ro.observe(area);
    // 行高そのものの変化(Webフォント適用・段数バッジ表示など)も拾う
    const table = area.querySelector('table');
    if (table) ro.observe(table);
    // Webフォント(IBM Plex Mono)読込後に行高が変わるため再計測する
    if (document.fonts?.ready) document.fonts.ready.then(measureMaxRows).catch(() => {});
    return () => ro.disconnect();
  }, [hasData, measureMaxRows]);

  const pages = useMemo(
    () => buildPages(groupByCategory(prices), maxRows),
    [prices, maxRows]
  );

  // pages は prices 更新のたびに新しい配列になり得るため、setInterval を
  // pages.length に依存させるとタイマーが張り直され続けて発火できなくなる
  // (=最後まで行っても最初のページに戻らずフリーズしたように見える)。
  // ref経由で最新値を読むことで、タイマーはマウント時に一度だけ作成し
  // 常に一定間隔で確実に発火させる。
  const pagesRef = useRef(pages);
  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);

  useEffect(() => {
    const id = setInterval(() => {
      const len = pagesRef.current.length;
      if (len <= 1) return;
      setPageIndex((i) => (i + 1) % len);
    }, PAGE_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  // pages が短くなって pageIndex が範囲外になっても、setState を使わずその場で安全な値に丸める
  const currentPage = pages.length > 0 ? pages[pageIndex % pages.length] : [];
  const pageLabel = `P.${(pageIndex % pages.length) + 1}/${pages.length}`;

  return (
    <div
      ref={rootRef}
      className={`board-mono board-viewport flex flex-col overflow-hidden text-white p-8 transition-colors duration-500 ${crashActive ? 'bg-red-950' : 'bg-[#060a12]'}`}
      style={!crashActive ? { backgroundImage: 'radial-gradient(120% 90% at 50% -10%, #0c1524 0%, #05080e 62%)' } : undefined}
    >
      {/* 暴落演出オーバーレイ（フェーズ3）: 全体赤転＋残り時間（アイコンなし） */}
      {crashActive && (
        <>
          <div className="pointer-events-none fixed inset-0 z-40 border-[10px] border-red-600 animate-pulse" style={{ boxShadow: 'inset 0 0 120px rgba(220,38,38,0.55)' }} />
          <div className="board-display fixed top-0 left-1/2 -translate-x-1/2 z-50 mt-3 px-8 py-2 rounded-full bg-red-600 text-white font-bold text-2xl tracking-wider shadow-lg flex items-center gap-3">
            <span>暴落中</span>
            <span className="board-mono tabular-nums">残り {crashMMSS}</span>
          </div>
        </>
      )}
      {/* 開場演出オーバーレイ（Phase6-3）: 寄り付き＝価格がリセットされました（アイコンなし） */}
      {marketOpenShow && !crashActive && (
        <>
          <div className="pointer-events-none fixed inset-0 z-40 border-[10px] border-emerald-500 animate-pulse" style={{ boxShadow: 'inset 0 0 120px rgba(16,185,129,0.5)' }} />
          <div className="board-display fixed top-0 left-1/2 -translate-x-1/2 z-50 mt-3 px-8 py-2 rounded-full bg-emerald-500 text-white font-bold text-2xl tracking-wider shadow-lg">
            価格がリセットされました
          </div>
        </>
      )}
      {/* ヘッダー */}
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <div className="flex items-center gap-5">
          <img src="/FANZONE_logo_A2.png" alt="ロゴ" className="h-14 w-auto object-contain" />
          <div>
            <h1 className="board-display text-[3.5rem] font-bold tracking-[0.12em] leading-none text-white">
              FANZONE EXCHANGE
            </h1>
            <p className="text-slate-500 text-sm mt-2 tracking-[0.42em] font-semibold uppercase">
              Live Drink Prices
            </p>
          </div>
        </div>
        <div className="text-right">
          <Clock />
          {priceOffline ? (
            <p className="text-red-400 text-base mt-1.5 tracking-wider font-bold">⚠ 接続が切れています・価格更新停止中</p>
          ) : (
            <p className="text-slate-500 text-sm mt-1.5 tracking-[0.2em] uppercase">
              <span className="text-[#1fe08a]">●</span> Market Open ・ 変動中 ・ {pageLabel}
            </p>
          )}
        </div>
      </div>

      {/* 上部ティッカー */}
      {prices.length > 0 && <Ticker prices={prices} />}

      {/* 価格テーブル */}
      {prices.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-slate-600 text-xl">
          接続中...
        </div>
      ) : (
        <div ref={tableAreaRef} className="flex-1 min-h-0 overflow-hidden">
          <table className="w-full table-fixed">
            <colgroup>
              <col style={{ width: '25%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '15%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '11%' }} />
            </colgroup>
            <thead>
              <tr className="text-slate-400 text-sm uppercase tracking-[0.2em] border-b border-slate-700/60">
                <th className="px-4 py-2.5 text-left font-medium">商品名</th>
                <th className="px-4 py-2.5 text-left font-medium">値動き</th>
                <th className="px-4 py-2.5 text-right font-medium">基準値</th>
                <th className="px-4 py-2.5 text-right font-medium">現在値</th>
                <th className="px-4 py-2.5 text-right font-medium">変動幅(%)</th>
                <th className="px-4 py-2.5 text-right font-medium">同日高値</th>
                <th className="px-4 py-2.5 text-right font-medium">同日底値</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                // 商品行(カテゴリ見出しを除く)の通し番号でゼブラ背景を決める。ページ毎にリセット。
                let rowIdx = 0;
                return currentPage.map((group) => (
                  <Fragment key={group.categoryId}>
                    <CategoryHeaderRow name={group.categoryName} continued={group.continued} />
                    {group.items.map((item) => (
                      <PriceRow key={item.id} item={item} zebra={rowIdx++ % 2 === 1} />
                    ))}
                  </Fragment>
                ));
              })()}
            </tbody>
          </table>
        </div>
      )}

      {/* フッター（凡例） */}
      <div className="mt-4 text-center text-slate-600 text-sm tracking-wider flex-shrink-0">
        ▲▼は本日の寄り付き価格（基準値）との比較
        <span className="mx-3 text-slate-800">|</span>
        <span className="text-slate-700">価格は需要に応じてリアルタイムで変動します</span>
      </div>

      {/* 全画面切替（右下・控えめ）。タッチで1タップ全画面。PWA起動時は非表示。 */}
      {!isStandalone && (
        <button
          type="button"
          onClick={toggleFullscreen}
          aria-label={isFullscreen ? '全画面を終了' : '全画面表示'}
          title={isFullscreen ? '全画面を終了' : '全画面表示'}
          className="fixed bottom-3 right-3 z-30 w-12 h-12 inline-flex items-center justify-center rounded-lg border border-slate-700/50 bg-slate-900/60 text-slate-500 opacity-30 hover:opacity-100 hover:text-slate-200 active:opacity-100 transition-opacity cursor-pointer"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {isFullscreen
              ? <><path d="M9 3v6H3" /><path d="M15 3v6h6" /><path d="M9 21v-6H3" /><path d="M15 21v-6h6" /></>
              : <><path d="M3 9V3h6" /><path d="M21 9V3h-6" /><path d="M3 15v6h6" /><path d="M21 15v6h-6" /></>}
          </svg>
        </button>
      )}
    </div>
  );
}
