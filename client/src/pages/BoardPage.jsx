import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import socket from '../socket';
import usePriceStore from '../store/usePriceStore';
import PriceRow from '../components/board/PriceRow';
import CategoryHeaderRow from '../components/board/CategoryHeaderRow';
import { yen, num } from '../utils/format';

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

  useEffect(() => {
    api.getPrices().then(initPrices).catch(console.error);
  }, []);

  useEffect(() => {
    const handle = ({ items }) => updatePrices(items);
    socket.on('prices:updated', handle);
    return () => socket.off('prices:updated', handle);
  }, []);

  // 初回取得の失敗やソケット切断に対する自己修復(TablePage.jsxと同じパターン)
  useEffect(() => {
    const handlePricesSync = ({ items }) => initPrices(items);
    const handleReconnect  = () => { api.getPrices().then(initPrices).catch(console.error); };
    socket.on('prices:sync', handlePricesSync);
    socket.on('connect',     handleReconnect);
    return () => {
      socket.off('prices:sync', handlePricesSync);
      socket.off('connect',     handleReconnect);
    };
  }, []);

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
    <div className="h-screen flex flex-col overflow-hidden bg-slate-950 text-white p-8 pb-16">
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
          <p className="text-slate-600 text-xs mt-1 tracking-wider">30秒ごとに更新</p>
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
