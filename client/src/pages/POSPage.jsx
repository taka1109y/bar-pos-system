import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import socket from '../socket';
import usePriceStore from '../store/usePriceStore';
import TableGrid from '../components/pos/TableGrid';
import OrderPanel from '../components/pos/OrderPanel';
import MenuManager from '../components/menu/MenuManager';
import CategoryManager from '../components/menu/CategoryManager';
import PricingSettings from '../components/menu/PricingSettings';
import ReportsPage from './ReportsPage';
import TableManager from '../components/tables/TableManager';
import ReceiptsPage from './ReceiptsPage';
import SystemSettingsPage from './SystemSettingsPage';

const NAV_ITEMS = [
  { id: 'pos',      label: 'レジ画面',      desc: 'テーブル選択・注文' },
  { id: 'tables',   label: 'テーブル管理',  desc: 'テーブル・カウンター' },
  { id: 'menu',     label: '商品管理',      desc: 'メニュー・価格設定' },
  { id: 'categories', label: 'カテゴリ管理', desc: 'カテゴリ・サブカテゴリ' },
  { id: 'pricing',  label: '価格エンジン',  desc: 'パラメータ設定' },
  { id: 'reports',  label: '売上管理',      desc: '日次レポート・分析' },
  { id: 'receipts', label: '伝票情報',      desc: '会計済み伝票の閲覧' },
  { id: 'system',   label: 'システム管理', desc: '消費税・システム設定' },
];

export default function POSPage() {
  const queryClient = useQueryClient();
  const [view, setView] = useState('pos');
  const [selectedTable, setSelectedTable] = useState(null);
  const { initPrices, updatePrices } = usePriceStore();

  const { data: tables = [] } = useQuery({
    queryKey: ['tables'],
    queryFn: api.getTables,
    refetchInterval: 30_000,
  });

  const { data: openOrders = [] } = useQuery({
    queryKey: ['orders-open'],
    queryFn: api.getOpenOrders,
    refetchInterval: 30_000,
  });

  const { data: menuItems = [] } = useQuery({
    queryKey: ['menu'],
    queryFn: api.getMenu,
    staleTime: 60_000,
  });

  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: api.getCategories,
    staleTime: 60_000,
  });

  const { data: subcategories = [] } = useQuery({
    queryKey: ['subcategories'],
    queryFn: api.getSubcategories,
    staleTime: 60_000,
  });

  useEffect(() => {
    api.getPrices().then(initPrices).catch(console.error);
  }, []);

  useEffect(() => {
    socket.on('prices:updated', ({ items }) => updatePrices(items));
    socket.on('prices:sync',    ({ items }) => initPrices(items));

    socket.on('table:status_changed', ({ tableId, status }) => {
      queryClient.setQueryData(['tables'], (old) =>
        old?.map((t) => (t.id === tableId ? { ...t, status } : t)) ?? old
      );
      queryClient.invalidateQueries({ queryKey: ['orders-open'] });
    });

    socket.on('order:updated', () => {
      queryClient.invalidateQueries({ queryKey: ['orders-open'] });
    });

    return () => {
      socket.off('prices:updated');
      socket.off('prices:sync');
      socket.off('table:status_changed');
      socket.off('order:updated');
    };
  }, []);

  const handleSelectTable = (table) => {
    setSelectedTable((prev) => (prev?.id === table.id ? null : table));
  };

  // 管理画面を離れるときにキャッシュ更新
  const handleSetView = (nextView) => {
    if (view === 'menu' || view === 'categories') {
      queryClient.invalidateQueries({ queryKey: ['menu'] });
      queryClient.invalidateQueries({ queryKey: ['categories'] });
      queryClient.invalidateQueries({ queryKey: ['subcategories'] });
    }
    if (view === 'tables') {
      queryClient.invalidateQueries({ queryKey: ['tables'] });
    }
    setView(nextView);
    if (nextView !== 'pos') setSelectedTable(null);
  };

  const currentTable = selectedTable
    ? tables.find((t) => t.id === selectedTable.id) ?? selectedTable
    : null;

  const occupiedCount = openOrders.length;

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      {/* ─── サイドバー ─── */}
      <aside className="w-52 bg-white border-r border-gray-200 flex flex-col flex-shrink-0 shadow-sm">
        {/* ブランド */}
        <div className="px-4 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2.5">
            <span className="text-2xl">🍺</span>
            <div>
              <p className="font-bold text-gray-900 text-sm leading-tight">Sports Bar</p>
              <p className="text-[11px] text-gray-400 font-medium">POS 管理画面</p>
            </div>
          </div>
        </div>

        {/* ナビゲーション */}
        <nav className="flex-1 p-3 space-y-0.5">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => handleSetView(item.id)}
              className={`w-full text-left px-3 py-2.5 rounded-lg transition-all ${
                view === item.id
                  ? 'bg-blue-50 text-blue-700 font-semibold'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 font-medium'
              }`}
            >
              <span className="text-sm block">{item.label}</span>
              <span className={`text-[11px] block mt-0.5 ${view === item.id ? 'text-blue-400' : 'text-gray-400'}`}>
                {item.desc}
              </span>
            </button>
          ))}

          <div className="pt-3 mt-1 border-t border-gray-100 space-y-0.5">
            <a
              href="/board"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between w-full px-3 py-2.5 rounded-lg text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors font-medium"
            >
              <span>価格ボード</span>
              <span className="text-xs text-gray-300 font-normal">↗</span>
            </a>
            <a
              href="/kitchen"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between w-full px-3 py-2.5 rounded-lg text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors font-medium"
            >
              <span>キッチン</span>
              <span className="text-xs text-gray-300 font-normal">↗</span>
            </a>
          </div>
        </nav>

        {/* ステータスエリア */}
        <div className="p-3 border-t border-gray-100 space-y-2">
          {/* テーブル稼働状況 */}
          <div className="px-3 py-2 bg-gray-50 rounded-lg">
            <p className="text-[11px] text-gray-400 font-medium mb-1">テーブル稼働</p>
            <p className="text-sm font-bold text-gray-700">
              {occupiedCount}
              <span className="font-normal text-gray-400"> / {tables.length} 席</span>
            </p>
          </div>

        </div>
      </aside>

      {/* ─── メインコンテンツ ─── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* コンテンツヘッダー */}
        <header className="bg-white border-b border-gray-200 px-6 py-3.5 flex items-center justify-between flex-shrink-0">
          <div>
            <h1 className="font-bold text-gray-900 text-base">
              {NAV_ITEMS.find((n) => n.id === view)?.label}
            </h1>
            <p className="text-xs text-gray-400 mt-0.5">
              {NAV_ITEMS.find((n) => n.id === view)?.desc}
            </p>
          </div>
        </header>

        {/* ─── レジ画面 ─── */}
        {view === 'pos' && (
          <div className="flex flex-1 overflow-hidden">
            <div className={`${currentTable ? 'hidden sm:block sm:flex-1' : 'flex-1'} overflow-y-auto`}>
              <TableGrid
                tables={tables}
                openOrders={openOrders}
                selectedTableId={currentTable?.id}
                onSelectTable={handleSelectTable}
              />
            </div>
            {currentTable && (
              <div className="w-full sm:w-80 md:w-96 flex-shrink-0 border-l border-gray-200">
                <OrderPanel
                  table={currentTable}
                  menuItems={menuItems}
                  categories={categories}
                  subcategories={subcategories}
                  onClose={() => setSelectedTable(null)}
                />
              </div>
            )}
          </div>
        )}

        {/* ─── テーブル管理 ─── */}
        {view === 'tables' && (
          <div className="flex-1 overflow-y-auto">
            <TableManager />
          </div>
        )}

        {/* ─── 商品管理 ─── */}
        {view === 'menu' && (
          <div className="flex-1 overflow-y-auto">
            <MenuManager />
          </div>
        )}

        {/* ─── カテゴリ管理 ─── */}
        {view === 'categories' && (
          <div className="flex-1 overflow-y-auto">
            <CategoryManager />
          </div>
        )}

        {/* ─── 価格エンジン設定 ─── */}
        {view === 'pricing' && (
          <div className="flex-1 overflow-y-auto">
            <PricingSettings />
          </div>
        )}

        {/* ─── 売上管理 ─── */}
        {view === 'reports' && (
          <div className="flex-1 overflow-y-auto">
            <ReportsPage inline />
          </div>
        )}

        {/* ─── 伝票情報 ─── */}
        {view === 'receipts' && (
          <div className="flex-1 overflow-y-auto">
            <ReceiptsPage />
          </div>
        )}

        {/* ─── システム管理 ─── */}
        {view === 'system' && (
          <div className="flex-1 overflow-y-auto">
            <SystemSettingsPage />
          </div>
        )}
      </div>
    </div>
  );
}
