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
  {
    id: 'pos', label: 'レジ画面', desc: 'テーブル選択・注文',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>,
  },
  {
    id: 'tables', label: 'テーブル管理', desc: 'テーブル・カウンター',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>,
  },
  {
    id: 'menu', label: '商品管理', desc: 'メニュー・価格設定',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/></svg>,
  },
  {
    id: 'categories', label: 'カテゴリ管理', desc: 'カテゴリ・サブカテゴリ',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>,
  },
  {
    id: 'pricing', label: '価格エンジン', desc: 'パラメータ設定',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>,
  },
  {
    id: 'reports', label: '売上管理', desc: '日次レポート・分析',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
  },
  {
    id: 'receipts', label: '伝票情報', desc: '会計済み伝票の閲覧',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>,
  },
  {
    id: 'system', label: 'システム管理', desc: '消費税・システム設定',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
  },
];

export default function POSPage() {
  const queryClient = useQueryClient();
  const [view, setView] = useState('pos');
  const [selectedTable, setSelectedTable] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
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
    const handlePricesUpdated    = ({ items }) => updatePrices(items);
    const handlePricesSync       = ({ items }) => initPrices(items);
    const handleTableStatusChanged = ({ tableId, status }) => {
      queryClient.setQueryData(['tables'], (old) =>
        old?.map((t) => (t.id === tableId ? { ...t, status } : t)) ?? old
      );
      queryClient.invalidateQueries({ queryKey: ['orders-open'] });
    };
    const handleOrderUpdated = () => {
      queryClient.invalidateQueries({ queryKey: ['orders-open'] });
    };

    socket.on('prices:updated',       handlePricesUpdated);
    socket.on('prices:sync',          handlePricesSync);
    socket.on('table:status_changed', handleTableStatusChanged);
    socket.on('order:updated',        handleOrderUpdated);

    return () => {
      socket.off('prices:updated',       handlePricesUpdated);
      socket.off('prices:sync',          handlePricesSync);
      socket.off('table:status_changed', handleTableStatusChanged);
      socket.off('order:updated',        handleOrderUpdated);
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

  const currentNav = NAV_ITEMS.find((n) => n.id === view);

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      {/* ─── サイドバー ─── */}
      <aside
        style={{ width: sidebarCollapsed ? '56px' : '224px', transition: 'width 0.2s ease' }}
        className="bg-white border-r border-slate-200 flex flex-col flex-shrink-0 overflow-hidden"
      >
        {/* ブランドヘッダー */}
        {sidebarCollapsed ? (
          <div className="flex flex-col items-center gap-2 px-0 py-3 border-b border-slate-100 flex-shrink-0">
            <div className="w-8 h-8 bg-primary-500 rounded-lg flex items-center justify-center flex-shrink-0">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3m8 0h3a2 2 0 0 0 2-2v-3"/></svg>
            </div>
            <button
              onClick={() => setSidebarCollapsed(false)}
              aria-label="サイドバーを展開"
              title="サイドバーを展開"
              className="w-7 h-7 flex items-center justify-center border border-slate-200 rounded-lg bg-slate-50 text-slate-400 hover:bg-slate-100 hover:text-primary-500 cursor-pointer"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 18l6-6-6-6"/></svg>
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2.5 px-3.5 py-4 border-b border-slate-100 flex-shrink-0">
            <div className="w-8 h-8 bg-primary-500 rounded-lg flex items-center justify-center flex-shrink-0">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3m8 0h3a2 2 0 0 0 2-2v-3"/></svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-black text-slate-900 text-sm leading-tight">Sports Bar</p>
              <p className="text-[11px] text-slate-400 font-medium">POS 管理画面</p>
            </div>
            <button
              onClick={() => setSidebarCollapsed(true)}
              aria-label="サイドバーを折りたたむ"
              title="サイドバーを折りたたむ"
              className="w-7 h-7 flex items-center justify-center border border-slate-200 rounded-lg bg-slate-50 text-slate-400 hover:bg-slate-100 hover:text-slate-600 cursor-pointer flex-shrink-0"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
          </div>
        )}

        {/* ナビゲーション */}
        <nav aria-label="メインナビゲーション" className="flex-1 p-3 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const isActive = view === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleSetView(item.id)}
                aria-label={sidebarCollapsed ? item.label : undefined}
                title={sidebarCollapsed ? item.label : undefined}
                style={{ marginTop: '6px', marginBottom: '6px' }}
                className={`w-full text-left rounded-lg transition-all flex items-center gap-2.5 ${
                  sidebarCollapsed ? 'justify-center px-0 py-3' : 'px-2.5 py-2.5'
                } ${
                  isActive
                    ? 'bg-primary-50 text-primary-700'
                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <span className={`flex-shrink-0 [&>svg]:w-full [&>svg]:h-full ${sidebarCollapsed ? 'w-5 h-5' : 'w-4 h-4'} ${isActive ? 'text-primary-600' : ''}`}>
                  {item.icon}
                </span>
                {!sidebarCollapsed && (
                  <div className="min-w-0">
                    <span className={`text-sm block font-semibold truncate ${isActive ? 'text-primary-700' : ''}`}>
                      {item.label}
                    </span>
                    <span className={`text-[10px] block truncate ${isActive ? 'text-primary-400' : 'text-slate-400'}`}>
                      {item.desc}
                    </span>
                  </div>
                )}
              </button>
            );
          })}

          <div className="pt-2 mt-1 border-t border-slate-100">
            {[
              {
                href: '/board',
                label: '価格ボード',
                icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>,
              },
              {
                href: '/kitchen',
                label: 'キッチン',
                icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>,
              },
            ].map(({ href, label, icon }) => (
              <a
                key={href}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                title={sidebarCollapsed ? label : undefined}
                style={{ marginTop: '6px', marginBottom: '6px' }}
                className={`flex items-center gap-2.5 w-full rounded-lg text-slate-400 hover:bg-slate-50 hover:text-slate-600 transition-colors ${
                  sidebarCollapsed ? 'justify-center px-0 py-3' : 'px-2.5 py-2.5'
                }`}
              >
                <span className={`flex-shrink-0 [&>svg]:w-full [&>svg]:h-full ${sidebarCollapsed ? 'w-5 h-5' : 'w-4 h-4'}`}>{icon}</span>
                {!sidebarCollapsed && (
                  <span className="text-sm font-semibold block flex-1">{label}</span>
                )}
                {!sidebarCollapsed && <span className="text-[10px] text-slate-300">↗</span>}
              </a>
            ))}
          </div>
        </nav>

      </aside>

      {/* ─── メインコンテンツ ─── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* コンテンツヘッダー */}
        <header className="bg-white border-b border-slate-200 px-6 py-3.5 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-primary-500 w-[18px] h-[18px] flex-shrink-0">{currentNav?.icon}</span>
            <div>
              <h1 className="font-bold text-slate-900 text-base">{currentNav?.label}</h1>
              <p className="text-xs text-slate-400 mt-0.5">{currentNav?.desc}</p>
            </div>
          </div>
        </header>

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

        {view === 'tables'     && <div className="flex-1 overflow-y-auto p-4"><TableManager /></div>}
        {view === 'menu'       && <div className="flex-1 overflow-y-auto p-4"><MenuManager /></div>}
        {view === 'categories' && <div className="flex-1 overflow-y-auto p-4"><CategoryManager /></div>}
        {view === 'pricing'    && <div className="flex-1 overflow-y-auto p-4"><PricingSettings /></div>}
        {view === 'reports'    && <div className="flex-1 overflow-y-auto p-4"><ReportsPage inline /></div>}
        {view === 'receipts'   && <div className="flex-1 overflow-y-auto p-4"><ReceiptsPage /></div>}
        {view === 'system'     && <div className="flex-1 overflow-y-auto p-4"><SystemSettingsPage /></div>}
      </div>
    </div>
  );
}
