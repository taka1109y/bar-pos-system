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
  { id: 'pos',        label: 'レジ画面',    desc: 'テーブル選択・注文',     icon: '🏠' },
  { id: 'tables',     label: 'テーブル管理', desc: 'テーブル・カウンター',    icon: '🪑' },
  { id: 'menu',       label: '商品管理',    desc: 'メニュー・価格設定',      icon: '📋' },
  { id: 'categories', label: 'カテゴリ管理', desc: 'カテゴリ・サブカテゴリ',  icon: '🏷️' },
  { id: 'pricing',    label: '価格エンジン', desc: 'パラメータ設定',         icon: '⚙️' },
  { id: 'reports',    label: '売上管理',    desc: '日次レポート・分析',      icon: '📊' },
  { id: 'receipts',   label: '伝票情報',    desc: '会計済み伝票の閲覧',     icon: '🧾' },
  { id: 'system',     label: 'システム管理', desc: '消費税・システム設定',    icon: '🔧' },
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
  const currentNav = NAV_ITEMS.find((n) => n.id === view);

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      {/* ─── サイドバー ─── */}
      <aside className="w-56 bg-white border-r border-slate-200 flex flex-col flex-shrink-0">
        {/* ブランドヘッダー */}
        <div className="px-4 py-4 bg-gradient-to-b from-indigo-600 to-indigo-700 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center text-lg">🍺</div>
            <div>
              <p className="font-black text-white text-sm leading-tight tracking-wide">Sports Bar</p>
              <p className="text-[11px] text-indigo-200 font-medium">POS 管理画面</p>
            </div>
          </div>
        </div>

        {/* ナビゲーション */}
        <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => handleSetView(item.id)}
              className={`w-full text-left px-3 py-2.5 rounded-lg transition-all flex items-center gap-3 ${
                view === item.id
                  ? 'bg-indigo-50 text-indigo-700 border-l-2 border-indigo-600 pl-2.5'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <span className="text-base flex-shrink-0">{item.icon}</span>
              <div className="min-w-0">
                <span className={`text-sm block font-semibold truncate ${view === item.id ? 'text-indigo-700' : ''}`}>
                  {item.label}
                </span>
                <span className={`text-[10px] block truncate ${view === item.id ? 'text-indigo-400' : 'text-slate-400'}`}>
                  {item.desc}
                </span>
              </div>
            </button>
          ))}

          <div className="pt-2 mt-1 border-t border-slate-100 space-y-0.5">
            <a
              href="/board"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-slate-400 hover:bg-slate-50 hover:text-slate-600 transition-colors"
            >
              <span className="text-base flex-shrink-0">📺</span>
              <div className="flex-1 min-w-0">
                <span className="text-sm font-semibold block">価格ボード</span>
              </div>
              <span className="text-[10px] text-slate-300">↗</span>
            </a>
            <a
              href="/kitchen"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-slate-400 hover:bg-slate-50 hover:text-slate-600 transition-colors"
            >
              <span className="text-base flex-shrink-0">🍳</span>
              <div className="flex-1 min-w-0">
                <span className="text-sm font-semibold block">キッチン</span>
              </div>
              <span className="text-[10px] text-slate-300">↗</span>
            </a>
          </div>
        </nav>

        {/* ステータス */}
        <div className="p-3 border-t border-slate-100 flex-shrink-0">
          <div className="px-3 py-2.5 bg-slate-50 rounded-lg border border-slate-100">
            <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider mb-1">テーブル稼働</p>
            <div className="flex items-baseline gap-1">
              <span className="text-xl font-black text-slate-800">{occupiedCount}</span>
              <span className="text-sm text-slate-400 font-medium">/ {tables.length} 席</span>
            </div>
          </div>
        </div>
      </aside>

      {/* ─── メインコンテンツ ─── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* コンテンツヘッダー */}
        <header className="bg-white border-b border-slate-200 px-6 py-3.5 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-xl">{currentNav?.icon}</span>
            <div>
              <h1 className="font-bold text-slate-900 text-base">{currentNav?.label}</h1>
              <p className="text-xs text-slate-400 mt-0.5">{currentNav?.desc}</p>
            </div>
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
              <div className="w-full sm:w-80 md:w-96 flex-shrink-0 border-l border-slate-200">
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

        {view === 'tables'     && <div className="flex-1 overflow-y-auto"><TableManager /></div>}
        {view === 'menu'       && <div className="flex-1 overflow-y-auto"><MenuManager /></div>}
        {view === 'categories' && <div className="flex-1 overflow-y-auto"><CategoryManager /></div>}
        {view === 'pricing'    && <div className="flex-1 overflow-y-auto"><PricingSettings /></div>}
        {view === 'reports'    && <div className="flex-1 overflow-y-auto"><ReportsPage inline /></div>}
        {view === 'receipts'   && <div className="flex-1 overflow-y-auto"><ReceiptsPage /></div>}
        {view === 'system'     && <div className="flex-1 overflow-y-auto"><SystemSettingsPage /></div>}
      </div>
    </div>
  );
}
