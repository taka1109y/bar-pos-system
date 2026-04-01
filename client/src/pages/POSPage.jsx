import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import socket from '../socket';
import usePriceStore from '../store/usePriceStore';
import TickerBar from '../components/layout/TickerBar';
import TableGrid from '../components/pos/TableGrid';
import OrderPanel from '../components/pos/OrderPanel';
import MenuManager from '../components/menu/MenuManager';
import ReportsPage from './ReportsPage';

export default function POSPage() {
  const queryClient = useQueryClient();
  const [selectedTable, setSelectedTable] = useState(null);
  const [showMenu, setShowMenu] = useState(false);
  const [showReports, setShowReports] = useState(false);
  const [calledTables, setCalledTables] = useState(new Set());
  const { initPrices, updatePrices } = usePriceStore();

  // テーブル一覧
  const { data: tables = [] } = useQuery({
    queryKey: ['tables'],
    queryFn: api.getTables,
    refetchInterval: 30_000,
  });

  // メニュー
  const { data: menuItems = [] } = useQuery({
    queryKey: ['menu'],
    queryFn: api.getMenu,
    staleTime: 60_000,
  });

  // カテゴリ
  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: api.getCategories,
    staleTime: 60_000,
  });

  // 価格初期化
  useEffect(() => {
    api.getPrices().then(initPrices).catch(console.error);
  }, []);

  // Socket.io
  useEffect(() => {
    socket.on('prices:updated', ({ items }) => {
      updatePrices(items);
    });

    socket.on('table:status_changed', ({ tableId, status }) => {
      queryClient.setQueryData(['tables'], (old) =>
        old?.map((t) => (t.id === tableId ? { ...t, status } : t)) ?? old
      );
    });

    // お客さんからのスタッフ呼び出し通知
    socket.on('staff:called', ({ tableId }) => {
      setCalledTables((prev) => new Set([...prev, tableId]));
    });

    return () => {
      socket.off('prices:updated');
      socket.off('table:status_changed');
      socket.off('staff:called');
    };
  }, []);

  const handleSelectTable = (table) => {
    setSelectedTable((prev) => (prev?.id === table.id ? null : table));
  };

  const handleAckCall = (tableId) => {
    setCalledTables((prev) => {
      const s = new Set(prev);
      s.delete(tableId);
      return s;
    });
  };

  // selectedTableをtablesの最新データで同期
  const currentTable = selectedTable
    ? tables.find((t) => t.id === selectedTable.id) ?? selectedTable
    : null;

  return (
    <div className="flex flex-col h-screen bg-slate-900">
      {/* ヘッダー */}
      <header className="flex items-center justify-between px-4 py-3 bg-slate-800 border-b border-slate-700">
        <div className="flex items-center gap-3">
          <span className="text-xl">🍺</span>
          <span className="font-bold text-white text-lg">Sports Bar POS</span>
          {calledTables.size > 0 && (
            <span className="bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full animate-pulse">
              呼び出し {calledTables.size}件
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/board"
            target="_blank"
            className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white rounded-lg text-sm transition-colors"
          >
            価格ボード
          </a>
          <button
            onClick={() => setShowReports(true)}
            className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white rounded-lg text-sm transition-colors"
          >
            売上レポート
          </button>
          <button
            onClick={() => setShowMenu(true)}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
          >
            メニュー管理
          </button>
        </div>
      </header>

      {/* ティッカーバー */}
      <TickerBar />

      {/* メインコンテンツ */}
      <div className="flex flex-1 overflow-hidden">
        {/* テーブルグリッド */}
        <div className={`${currentTable ? 'hidden sm:block sm:flex-1' : 'flex-1'} overflow-y-auto`}>
          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">テーブル一覧</h2>
              <div className="flex items-center gap-3 text-xs text-slate-500">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />空席</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />使用中</span>
              </div>
            </div>
          </div>
          <TableGrid
            tables={tables}
            selectedTableId={currentTable?.id}
            onSelectTable={handleSelectTable}
            calledTables={calledTables}
            onAckCall={handleAckCall}
          />
        </div>

        {/* 注文パネル */}
        {currentTable && (
          <div className="w-full sm:w-80 md:w-96 flex-shrink-0">
            <OrderPanel
              table={currentTable}
              menuItems={menuItems}
              categories={categories}
              onClose={() => setSelectedTable(null)}
            />
          </div>
        )}
      </div>

      {showMenu && <MenuManager onClose={() => { setShowMenu(false); queryClient.invalidateQueries({ queryKey: ['menu'] }); }} />}
      {showReports && <ReportsPage onClose={() => setShowReports(false)} />}
    </div>
  );
}
