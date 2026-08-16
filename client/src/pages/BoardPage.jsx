import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import socket from '../socket';
import usePriceStore from '../store/usePriceStore';
import { useConnStore } from '../store/useConnStore';
import PriceRow from '../components/board/PriceRow';
import CategoryHeaderRow from '../components/board/CategoryHeaderRow';
import { yen, num } from '../utils/format';
import { playNotification } from '../utils/audioAlert';

const HEADER_ROW_HEIGHT_PX = 44; // thead の概算高さ
const ROW_HEIGHT_PX        = 44; // カテゴリ見出し行・商品行 共通の概算高さ
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

// 画面に収まるだけ複数カテゴリを1ページにまとめ、収まらない分は次ページへ回す。
// 1カテゴリ単独でページ容量を超える場合は、そのカテゴリ自体を複数ページに分割する。
function buildPages(categoryGroups, maxRows) {
  const pages = [];
  let current = [];
  let currentRows = 0;

  const flushCurrent = () => {
    if (current.length > 0) pages.push(current);
    current = [];
    currentRows = 0;
  };

  for (const group of categoryGroups) {
    const groupRows = 1 + group.items.length; // 見出し1行 + 商品行
    if (groupRows <= maxRows) {
      if (currentRows + groupRows > maxRows) flushCurrent();
      current.push(group);
      currentRows += groupRows;
    } else {
      flushCurrent();
      const itemsPerChunk = Math.max(maxRows - 1, 1);
      for (let i = 0; i < group.items.length; i += itemsPerChunk) {
        pages.push([{
          categoryId:   group.categoryId,
          categoryName: group.categoryName,
          items:        group.items.slice(i, i + itemsPerChunk),
        }]);
      }
    }
  }
  flushCurrent();
  return pages.length > 0 ? pages : [[]];
}

function Ticker({ prices }) {
  if (prices.length === 0) return null;
  const items = [...prices, ...prices];
  return (
    <div className="fixed bottom-0 left-0 right-0 bg-slate-900/95 border-t border-slate-700/60 overflow-hidden py-2">
      <div className="flex whitespace-nowrap" style={{ animation: 'ticker 20s linear infinite' }}>
        {items.map((item, i) => {
          const pct    = Number(item.pct_change) || 0;
          const isUp   = pct > 0;
          const isDown = pct < 0;
          const pctColor   = isUp ? 'text-green-400' : isDown ? 'text-red-400' : 'text-slate-500';
          const pctDisplay = pct < 0 ? `-${num(Math.abs(pct), 1)}%` : `${num(Math.abs(pct), 1)}%`;
          return (
            <span key={i} className="inline-flex items-center gap-3 mx-10">
              <span className="text-slate-300 font-semibold tracking-wide">{item.name}</span>
              <span className="text-amber-300 font-bold tabular-nums">¥{yen(item.current_price)}</span>
              <span className={`font-bold tabular-nums ${pctColor}`}>{pctDisplay}</span>
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
    <span className="font-mono text-amber-400 text-2xl font-bold tracking-widest">
      {time.toLocaleTimeString('ja-JP')}
    </span>
  );
}

export default function BoardPage() {
  const { initPrices, updatePrices, getAllPrices } = usePriceStore();
  const prices = getAllPrices();

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

  // 期(15分)カウントダウン(Phase4): period_ends_at / period:tick から次の期までの残り時間を表示
  const [periodEndsAt, setPeriodEndsAt] = useState(null);
  const [periodRemaining, setPeriodRemaining] = useState(0);
  useEffect(() => {
    api.getSystemSettings().then((s) => { if (s?.period_ends_at) setPeriodEndsAt(s.period_ends_at); }).catch(() => {});
    const handlePeriod = (data) => { if (data?.endsAt) setPeriodEndsAt(data.endsAt); };
    socket.on('period:tick', handlePeriod);
    return () => socket.off('period:tick', handlePeriod);
  }, []);
  useEffect(() => {
    if (!periodEndsAt) { setPeriodRemaining(0); return; }
    const update = () => setPeriodRemaining(Math.max(0, Math.ceil((new Date(periodEndsAt).getTime() - Date.now()) / 1000)));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [periodEndsAt]);
  const periodMMSS = `${String(Math.floor(periodRemaining / 60)).padStart(2, '0')}:${String(periodRemaining % 60).padStart(2, '0')}`;

  const hasData = prices.length > 0;

  // 表示エリアの実高さから、1ページに収まる行数を計算する
  useEffect(() => {
    const el = tableAreaRef.current;
    if (!el) return;
    const compute = () => {
      const available = el.clientHeight - HEADER_ROW_HEIGHT_PX;
      setMaxRows(Math.max(Math.floor(available / ROW_HEIGHT_PX), 3));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasData]);

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

  return (
    <div className={`h-screen flex flex-col overflow-hidden text-white p-8 pb-16 transition-colors duration-500 ${crashActive ? 'bg-red-950' : 'bg-slate-950'}`}>
      {/* 暴落演出オーバーレイ（フェーズ3）: 全体赤転＋残り時間 */}
      {crashActive && (
        <>
          <div className="pointer-events-none fixed inset-0 z-40 border-[10px] border-red-600 animate-pulse" style={{ boxShadow: 'inset 0 0 120px rgba(220,38,38,0.55)' }} />
          <div className="fixed top-0 left-1/2 -translate-x-1/2 z-50 mt-3 px-6 py-2 rounded-full bg-red-600 text-white font-black text-xl shadow-lg flex items-center gap-3">
            <span className="animate-pulse">🔻 暴落中</span>
            <span className="tabular-nums">残り {crashMMSS}</span>
          </div>
        </>
      )}
      {/* 開場演出オーバーレイ（Phase6-3）: 寄り付き */}
      {marketOpenShow && !crashActive && (
        <>
          <div className="pointer-events-none fixed inset-0 z-40 border-[10px] border-emerald-500 animate-pulse" style={{ boxShadow: 'inset 0 0 120px rgba(16,185,129,0.5)' }} />
          <div className="fixed top-0 left-1/2 -translate-x-1/2 z-50 mt-3 px-8 py-2 rounded-full bg-emerald-500 text-white font-black text-2xl shadow-lg flex items-center gap-3">
            <span className="animate-pulse">🔔 OPEN</span>
            <span className="tracking-widest">寄り付き</span>
          </div>
        </>
      )}
      {/* ヘッダー */}
      <div className="flex items-center justify-between mb-8 flex-shrink-0">
        <div className="flex items-center gap-5">
          <img src="/FANZONE_logo_A2.png" alt="ロゴ" className="h-14 w-auto object-contain" />
          <div>
            <h1 className="text-4xl font-black tracking-widest leading-tight text-white">
              SPORTS BAR
            </h1>
            <p className="text-slate-500 text-sm mt-1 tracking-[0.4em] font-semibold uppercase">
              Live Drink Prices
            </p>
          </div>
        </div>
        <div className="text-right">
          <Clock />
          {priceOffline ? (
            <p className="text-red-400 text-sm mt-1 tracking-wider font-bold">⚠ 接続が切れています・価格更新停止中</p>
          ) : periodEndsAt ? (
            <p className="text-amber-400 text-sm mt-1 tracking-wider font-bold tabular-nums">次の変動まで {periodMMSS}</p>
          ) : (
            <p className="text-slate-600 text-xs mt-1 tracking-wider">価格変動中</p>
          )}
        </div>
      </div>

      {/* 価格テーブル */}
      {prices.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-slate-600 text-xl">
          接続中...
        </div>
      ) : (
        <div ref={tableAreaRef} className="flex-1 min-h-0">
          <div className="h-full rounded-xl overflow-hidden border border-slate-700/50 flex flex-col">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-900 text-xs text-slate-500 uppercase tracking-widest border-b border-slate-700">
                  <th className="px-4 py-3 text-left">商品名</th>
                  <th className="px-4 py-3 text-right">基準値</th>
                  <th className="px-4 py-3 text-right">現在値</th>
                  <th className="px-4 py-3 text-right">変動幅(円)</th>
                  <th className="px-4 py-3 text-right">変動幅(%)</th>
                  <th className="px-4 py-3 text-right">同日高値</th>
                  <th className="px-4 py-3 text-right">同日底値</th>
                </tr>
              </thead>
              <tbody>
                {currentPage.map((group) => (
                  <Fragment key={group.categoryId}>
                    <CategoryHeaderRow name={group.categoryName} />
                    {group.items.map((item) => (
                      <PriceRow key={item.id} item={item} />
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* フッター */}
      <div className="mt-8 text-center text-slate-700 text-sm tracking-wider flex-shrink-0">
        価格は需要に応じてリアルタイムで変動します
      </div>

      <Ticker prices={prices} />
    </div>
  );
}
