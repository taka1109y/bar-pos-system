import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import socket from '../socket';
import usePriceStore from '../store/usePriceStore';
import TickerBar from '../components/layout/TickerBar';
import MenuGrid, { CategorySidebar } from '../components/pos/MenuGrid';
import { yen } from '../utils/format';
import { useConnStore } from '../store/useConnStore';

function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

// ───────────────────────────────────────────
// 人数選択 初期画面
// ───────────────────────────────────────────
function WelcomeScreen({ tableName, onSelectGuests }) {
  const now     = useClock();
  const timeStr = now.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <div className="flex flex-col h-screen overflow-hidden select-none" style={{ background: '#0b0b0f' }}>
      <div className="flex items-start justify-between px-8 pt-8 pb-0 flex-shrink-0">
        <div>
          <p style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 13, letterSpacing: '3px', color: '#3a3a50', marginBottom: 4 }}>
            TABLE
          </p>
          <p style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 42, color: '#f0f0f5', lineHeight: 1 }}>
            {tableName}
          </p>
        </div>
        <p className="tabular-nums" style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 50, fontWeight: 700, color: '#f0f0f5', lineHeight: 1 }}>
          {timeStr}
        </p>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-8 gap-10">
        <div className="text-center">
          <p style={{ color: '#7a7a90', fontSize: 18, fontWeight: 500, marginBottom: 10 }}>いらっしゃいませ</p>
          <p style={{ fontFamily: "'Noto Sans JP', sans-serif", color: '#f0f0f5', fontSize: 36, fontWeight: 900, lineHeight: 1.4 }}>
            何名様でいらっしゃいますか？
          </p>
        </div>

        <div className="grid grid-cols-5 gap-4 w-full max-w-xl">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              onClick={() => onSelectGuests(n)}
              className="aspect-square flex flex-col items-center justify-center active:scale-95"
              style={{ background: '#1e1e28', border: '1px solid #252532', borderRadius: 18, cursor: 'pointer', transition: 'all 0.15s' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background  = '#e52233';
                e.currentTarget.style.borderColor = '#e52233';
                e.currentTarget.style.boxShadow   = '0 0 20px rgba(229,34,51,0.4)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background  = '#1e1e28';
                e.currentTarget.style.borderColor = '#252532';
                e.currentTarget.style.boxShadow   = 'none';
              }}
            >
              <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 38, fontWeight: 700, color: '#f0f0f5', lineHeight: 1 }}>
                {n}
              </span>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#7a7a90', marginTop: 3 }}>名</span>
            </button>
          ))}
        </div>

        <p style={{ color: '#3a3a50', fontSize: 16 }}>タップして人数をお選びください</p>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────
// 価格暴落バナー
// ───────────────────────────────────────────
function CrashBanner({ crashState, categories, subcategories, onSelectCategory, onSelectSubcategory, onDismiss }) {
  if (!crashState) return null;

  const crashedCats = categories.filter((c) => crashState.category_ids?.includes(c.id));
  const crashedSubs = subcategories.filter((s) => crashState.subcategory_ids?.includes(s.id));

  const chipStyle = {
    background: 'rgba(255,255,255,0.18)',
    border: '1px solid rgba(255,255,255,0.45)',
    borderRadius: 20,
    padding: '5px 16px',
    color: '#fff',
    fontSize: 15,
    fontWeight: 700,
    fontFamily: "'Noto Sans JP', sans-serif",
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    transition: 'background 0.13s',
  };

  return (
    <div
      className="crash-banner-slide flex-shrink-0"
      style={{ background: 'linear-gradient(90deg,#7a0010,#c41230,#7a0010)', borderBottom: '2px solid #ff2244', zIndex: 30 }}
    >
      <div className="flex items-center gap-3 px-4 py-2.5 flex-wrap">
        <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, letterSpacing: '3px', color: '#fff', whiteSpace: 'nowrap', textShadow: '0 0 12px rgba(255,100,100,0.6)' }}>
          価格暴落中！
        </span>
        <div className="flex items-center gap-2 flex-wrap flex-1">
          {crashedCats.map((cat) => (
            <button
              key={`cat-${cat.id}`}
              onClick={() => onSelectCategory(cat.id)}
              style={chipStyle}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.3)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.18)'; }}
            >
              {cat.name} ▶
            </button>
          ))}
          {crashedCats.length > 0 && (
            <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', fontFamily: "'Noto Sans JP', sans-serif" }}>
              タップして移動
            </span>
          )}
        </div>
        <button
          onClick={onDismiss}
          aria-label="閉じる"
          style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.7)', fontSize: 26, cursor: 'pointer', padding: '0 4px', lineHeight: 1, flexShrink: 0 }}
        >
          ×
        </button>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────
// 注文確認モーダル（中央表示）
// ───────────────────────────────────────────
function ConfirmModal({ item, livePrice, onConfirm, onCancel }) {
  const price     = livePrice?.current_price ?? item.current_price;
  const pctChange = livePrice?.pct_change ?? 0;
  const isUp      = pctChange > 0;

  return (
    <>
      <div
        className="fixed inset-0 z-40 fade-in"
        style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(6px)' }}
        onClick={onCancel}
      />
      <div className="fixed z-50 modal-slide-up" style={{ top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 360 }}>
        <div style={{ background: '#14141a', border: '1px solid #e52233', borderRadius: 20, boxShadow: '0 0 48px rgba(229,34,51,0.35)', padding: '32px 28px 28px' }}>
          <p className="text-center mb-6" style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, letterSpacing: '3px', color: '#f0f0f5' }}>
            注文を確認
          </p>
          <h3 className="text-center mb-2" style={{ fontFamily: "'Noto Sans JP', sans-serif", fontSize: 19, fontWeight: 700, color: '#ffc531' }}>
            {item.name}
          </h3>
          <div className="flex items-baseline justify-center gap-3 mb-8">
            <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 40, fontWeight: 700, color: '#f0f0f5' }}>
              ¥{yen(price)}
            </span>
            {item.is_drink && pctChange !== 0 && (
              <span style={{ fontSize: 16, fontWeight: 700, color: isUp ? '#00e5a0' : '#ff4466' }}>
                {isUp ? '▲' : '▼'}{Math.abs(pctChange).toFixed(1)}%
              </span>
            )}
          </div>
          <button
            onClick={() => onConfirm(1)}
            className="w-full active:scale-[0.98]"
            style={{
              background: 'linear-gradient(90deg,#e52233,#9a1020)', border: 'none', borderRadius: 12,
              padding: '16px 0', color: '#fff', fontFamily: "'Noto Sans JP', sans-serif",
              fontSize: 18, fontWeight: 700, cursor: 'pointer', marginBottom: 12,
              boxShadow: '0 0 24px rgba(229,34,51,0.3)', transition: 'all 0.12s',
            }}
          >
            注文する
          </button>
          <button
            onClick={onCancel}
            className="w-full"
            style={{
              background: 'transparent', border: 'none', padding: '12px 0',
              color: '#7a7a90', fontSize: 15, cursor: 'pointer',
              fontFamily: "'Noto Sans JP', sans-serif", transition: 'color 0.15s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#f0f0f5'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = '#7a7a90'; }}
          >
            キャンセル
          </button>
        </div>
      </div>
    </>
  );
}

// ───────────────────────────────────────────
// 注文送信トースト
// ───────────────────────────────────────────
function OrderToast({ toast }) {
  if (!toast) return null;
  if (toast.error) {
    return (
      <div className="sent-pop fixed z-50 pointer-events-none" style={{ top: 88, left: '50%', whiteSpace: 'nowrap' }}>
        <div style={{
          background: '#ff4466', color: '#1a0006', borderRadius: 50,
          padding: '12px 32px', fontFamily: "'Noto Sans JP', sans-serif",
          fontSize: 16, fontWeight: 700, boxShadow: '0 0 32px rgba(255,68,102,0.3)',
        }}>
          {toast.error}
        </div>
      </div>
    );
  }
  return (
    <div className="sent-pop fixed z-50 pointer-events-none" style={{ top: 88, left: '50%', whiteSpace: 'nowrap' }}>
      <div style={{
        background: '#00e5a0', color: '#001a10', borderRadius: 50,
        padding: '12px 32px', fontFamily: "'Noto Sans JP', sans-serif",
        fontSize: 16, fontWeight: 700, boxShadow: '0 0 32px rgba(0,229,160,0.3)',
      }}>
        ✓ 「{toast.name}」を注文しました ¥{yen(toast.price)}
      </div>
    </div>
  );
}

// ───────────────────────────────────────────
// トップバー
// ───────────────────────────────────────────
function TopBar({ tableName, tableId, guestCount, timeStr }) {
  return (
    <div
      className="flex items-center justify-between flex-shrink-0 px-5"
      style={{ height: 68, background: 'linear-gradient(90deg,#0b0b0f,#18181f 50%,#0b0b0f)', borderBottom: '1px solid #252532', position: 'relative' }}
    >
      <div className="absolute top-0 left-0 right-0" style={{ height: 2, background: 'linear-gradient(90deg,transparent,#e52233,transparent)' }} />
      <div className="flex items-center" style={{ paddingLeft: 8 }}>
        <img src="/FANZONE_logo_A2.png" alt="ロゴ" style={{ height: 38, width: 'auto' }} />
      </div>
      <div className="flex items-center gap-4">
        <div className="flex flex-col items-center justify-center px-3 py-1.5" style={{ background: '#1e1e28', borderRadius: 8, minWidth: 56 }}>
          <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 10, color: '#3a3a50', letterSpacing: '1px' }}>TABLE</span>
          <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 24, fontWeight: 700, color: '#ffc531', lineHeight: 1 }}>{tableId}</span>
        </div>
        <span className="tabular-nums" style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 26, fontWeight: 700, color: '#f0f0f5' }}>
          {timeStr}
        </span>
        <div style={{ fontSize: 15, color: '#7a7a90', fontFamily: "'Noto Sans JP', sans-serif" }}>{guestCount}名様</div>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────
// 注文履歴パネル（右側）
// ───────────────────────────────────────────
function OrderHistoryPanel({ order, chargeAmt, total, itemCount }) {
  const items = order?.items ?? [];
  return (
    <div className="flex flex-col flex-shrink-0" style={{ width: 250, background: '#14141a', borderLeft: '1px solid #252532' }}>
      <div className="flex items-center justify-between flex-shrink-0 px-4 py-3" style={{ background: '#1e1e28', borderBottom: '1px solid #252532' }}>
        <p style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: '#f0f0f5', letterSpacing: '2px' }}>注文履歴</p>
        {itemCount > 0 && (
          <span className="flex items-center justify-center" style={{ background: '#e52233', color: '#fff', borderRadius: 50, minWidth: 24, height: 24, fontSize: 13, fontWeight: 700, fontFamily: "'Barlow Condensed', sans-serif", padding: '0 6px' }}>
            {itemCount}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-dark">
        {chargeAmt > 0 && (
          <div className="px-4 py-3" style={{ background: 'rgba(255,197,49,0.07)', borderBottom: '1px solid #252532' }}>
            <div className="flex items-center justify-between">
              <div>
                <p style={{ fontFamily: "'Noto Sans JP', sans-serif", fontSize: 14, fontWeight: 700, color: '#ffc531' }}>チャージ</p>
                <p style={{ fontSize: 12, color: '#7a7a90', fontFamily: "'Noto Sans JP', sans-serif" }}>
                  {order.guest_count}名 × ¥{Math.floor(order.charge_per_person).toLocaleString()}
                </p>
              </div>
              <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 17, fontWeight: 700, color: '#ffc531' }}>
                ¥{Math.floor(chargeAmt).toLocaleString()}
              </span>
            </div>
          </div>
        )}
        {items.length === 0 && chargeAmt === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2">
            <span style={{ fontSize: 30 }}>🍺</span>
            <p style={{ fontSize: 14, color: '#3a3a50', fontFamily: "'Noto Sans JP', sans-serif" }}>まだ注文がありません</p>
          </div>
        ) : (
          items.map((item, idx) => (
            <div key={item.id} className="px-4 py-3" style={{ borderBottom: '1px solid #252532', background: idx === 0 ? 'rgba(0,229,160,0.04)' : 'transparent' }}>
              <div className="flex items-start justify-between gap-2">
                <p className="leading-snug flex-1 line-clamp-2" style={{ fontFamily: "'Noto Sans JP', sans-serif", fontSize: 14, fontWeight: 600, color: '#f0f0f5' }}>
                  {item.item_name}
                </p>
                <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 16, fontWeight: 700, color: '#ffc531', flexShrink: 0 }}>
                  ¥{(item.quantity * item.unit_price).toLocaleString()}
                </span>
              </div>
              <p style={{ fontSize: 13, color: '#7a7a90', fontFamily: "'Barlow Condensed', sans-serif", marginTop: 2 }}>× {item.quantity}</p>
            </div>
          ))
        )}
      </div>

      <div className="flex-shrink-0 px-4 py-4" style={{ borderTop: '1px solid #252532', background: 'linear-gradient(180deg,#14141a,#150a0c)' }}>
        <p style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 12, color: '#3a3a50', letterSpacing: '2px', marginBottom: 3 }}>合計金額</p>
        <p style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 34, fontWeight: 700, color: total > 0 ? '#ffc531' : '#3a3a50' }}>
          ¥{total.toLocaleString()}
        </p>
        <p style={{ fontSize: 11, color: '#3a3a50', fontFamily: "'Noto Sans JP', sans-serif", marginTop: 3 }}>※ 税込表示</p>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────
// メインページ
// ───────────────────────────────────────────
export default function TablePage() {
  const navigate     = useNavigate();
  const { tableId }  = useParams();
  const tableIdNum   = Number(tableId);
  const queryClient  = useQueryClient();
  const { initPrices, updatePrices, prices } = usePriceStore();

  const [confirmItem,       setConfirmItem]       = useState(null);
  const [guestCount,        setGuestCount]        = useState(null);
  const [toast,             setToast]             = useState(null);
  const [activeCategory,    setActiveCategory]    = useState(null);
  const [activeSubcategory, setActiveSubcategory] = useState(null);
  const [crashState,        setCrashState]        = useState(null);
  const [bannerDismissed,   setBannerDismissed]   = useState(false);
  const toastTimerRef = useRef(null);
  const connected = useConnStore((s) => s.connected);

  const now     = useClock();
  const timeStr = now.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  const orderKey = ['order', tableIdNum];

  const { data: tables = [] }        = useQuery({ queryKey: ['tables'],        queryFn: api.getTables });
  const { data: menuItems = [] }     = useQuery({ queryKey: ['menu'],          queryFn: api.getMenu,          staleTime: 60_000 });
  const { data: categories = [] }    = useQuery({ queryKey: ['categories'],    queryFn: api.getCategories,    staleTime: 60_000 });
  const { data: subcategories = [] } = useQuery({ queryKey: ['subcategories'], queryFn: api.getSubcategories, staleTime: 60_000 });
  const { data: order }              = useQuery({ queryKey: orderKey,          queryFn: () => api.getOrderByTable(tableIdNum), enabled: !!tableIdNum, refetchInterval: 10_000 });

  const table     = tables.find((t) => t.id === tableIdNum);
  const tableName = table?.name ?? `テーブル ${tableId}`;

  useEffect(() => {
    if (order != null && guestCount === null) setGuestCount(order.guest_count ?? 1);
  }, [order]);

  useEffect(() => { api.getPrices().then(initPrices).catch(console.error); }, []);

  // menuItems取得後に暴落中アイテムを検出して初期バナー表示
  useEffect(() => {
    if (menuItems.length === 0) return;
    const crashed = menuItems.filter((i) => i.is_crashed);
    if (crashed.length > 0) {
      const catIds = [...new Set(crashed.map((i) => i.category_id).filter(Boolean))];
      const subIds = [...new Set(crashed.map((i) => i.subcategory_id).filter(Boolean))];
      setCrashState({ category_ids: catIds, subcategory_ids: subIds });
    }
  }, [menuItems]);

  useEffect(() => {
    socket.emit('client:subscribe_table', { tableId: tableIdNum });
    const handlePricesUpdated = ({ items }) => updatePrices(items);
    const handlePricesSync    = ({ items }) => initPrices(items);
    const handleReconnect     = () => {
      api.getPrices().then(initPrices).catch(console.error);
      socket.emit('client:subscribe_table', { tableId: tableIdNum });
      queryClient.invalidateQueries({ queryKey: orderKey });
    };
    const handleOrderUpdated  = (data) => {
      if (data.tableId === tableIdNum) {
        queryClient.setQueryData(orderKey, (old) => ({
          ...(old ?? {}),
          id: data.orderId, table_id: tableIdNum, items: data.items,
          total_amount:      data.total,
          charge_amount:     data.chargeAmount    ?? old?.charge_amount,
          charge_per_person: data.chargePerPerson ?? old?.charge_per_person,
          guest_count:       data.guestCount      ?? old?.guest_count,
        }));
      }
    };
    const handleTableStatus = (data) => {
      if (data.tableId === tableIdNum && data.status === 'available') {
        queryClient.removeQueries({ queryKey: orderKey });
        navigate('/table');
      }
    };
    const handleCrashStarted = ({ category_ids, subcategory_ids }) => {
      setCrashState({ category_ids, subcategory_ids });
      setBannerDismissed(false);
    };
    const handleCrashEnded = () => setCrashState(null);
    socket.on('prices:updated',       handlePricesUpdated);
    socket.on('prices:sync',          handlePricesSync);
    socket.on('connect',              handleReconnect);
    socket.on('order:updated',        handleOrderUpdated);
    socket.on('table:status_changed', handleTableStatus);
    socket.on('crash:started',        handleCrashStarted);
    socket.on('crash:ended',          handleCrashEnded);
    return () => {
      socket.emit('client:unsubscribe_table', { tableId: tableIdNum });
      socket.off('prices:updated',       handlePricesUpdated);
      socket.off('prices:sync',          handlePricesSync);
      socket.off('connect',              handleReconnect);
      socket.off('order:updated',        handleOrderUpdated);
      socket.off('table:status_changed', handleTableStatus);
      socket.off('crash:started',        handleCrashStarted);
      socket.off('crash:ended',          handleCrashEnded);
    };
  }, [tableIdNum, navigate]);

  const showToast = (name, price) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ name, price });
    toastTimerRef.current = setTimeout(() => setToast(null), 2000);
  };

  const showErrorToast = (message) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ error: message });
    toastTimerRef.current = setTimeout(() => setToast(null), 2500);
  };

  const openOrderMutation = useMutation({
    mutationFn: (count) => api.createOrder(tableIdNum, count ?? guestCount ?? 1),
    onSuccess:  () => queryClient.invalidateQueries({ queryKey: orderKey }),
    onError: (err) => {
      if (err.message?.includes('already has an open order')) {
        queryClient.invalidateQueries({ queryKey: orderKey });
      } else {
        showErrorToast('注文を開始できませんでした。もう一度お試しください');
        setGuestCount(null);
      }
    },
  });

  const addItemMutation = useMutation({
    mutationFn: ({ orderId, menu_item_id, quantity }) => api.addOrderItem(orderId, { menu_item_id, quantity }),
    onMutate: async ({ menu_item_id, quantity, price, name }) => {
      await queryClient.cancelQueries({ queryKey: orderKey });
      const previous = queryClient.getQueryData(orderKey);
      queryClient.setQueryData(orderKey, (old) => {
        if (!old) return old;
        const existing = old.items?.find((i) => i.menu_item_id === menu_item_id);
        const newItems = existing
          ? old.items.map((i) => i.menu_item_id === menu_item_id ? { ...i, quantity: i.quantity + quantity } : i)
          : [...(old.items ?? []), { id: `temp-${Date.now()}`, menu_item_id, item_name: name, unit_price: price, quantity }];
        return { ...old, items: newItems };
      });
      return { previous };
    },
    onError:   (_err, _vars, context) => {
      queryClient.setQueryData(orderKey, context.previous);
      showErrorToast('注文できませんでした。もう一度お試しください');
    },
    onSuccess: (_data, vars) => { showToast(vars.name, vars.price); },
  });

  const handleSelectGuests = (count) => { setGuestCount(count); openOrderMutation.mutate(count); };
  const handleTapItem      = (menuItem) => setConfirmItem(menuItem);

  const handleCrashSelectCategory = (catId) => {
    setActiveCategory(catId);
    setActiveSubcategory(null);
  };
  const handleCrashSelectSubcategory = (sub) => {
    setActiveCategory(sub.category_id);
    setActiveSubcategory(sub.id);
  };

  const handleConfirmAdd = async (qty) => {
    const item       = confirmItem;
    setConfirmItem(null);
    const livePrice  = prices[item.id];
    const price      = livePrice?.current_price ?? item.current_price;
    let currentOrder = order;
    if (!currentOrder) {
      try {
        currentOrder = await openOrderMutation.mutateAsync(guestCount ?? 1);
      } catch {
        await queryClient.invalidateQueries({ queryKey: orderKey });
        currentOrder = queryClient.getQueryData(orderKey);
        if (!currentOrder) return;
      }
    }
    addItemMutation.mutate({ orderId: currentOrder.id, menu_item_id: item.id, quantity: qty, price, name: item.name });
  };

  const chargeAmt  = parseFloat(order?.charge_amount) || 0;
  const itemsTotal = order?.items?.reduce((s, i) => s + i.quantity * i.unit_price, 0) ?? 0;
  const total      = itemsTotal + chargeAmt;
  const itemCount  = order?.items?.reduce((s, i) => s + i.quantity, 0) ?? 0;
  const resolvedActiveCategory = activeCategory ?? categories[0]?.id;
  const subcatsForActiveCat    = subcategories.filter((s) => s.category_id === resolvedActiveCategory);

  if (guestCount === null) {
    return <WelcomeScreen tableName={tableName} onSelectGuests={handleSelectGuests} />;
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: '#0b0b0f' }}>
      <TopBar tableName={tableName} tableId={tableId} guestCount={order?.guest_count ?? guestCount} timeStr={timeStr} />
      {!connected && (
        <div style={{ background: '#ff4466', color: '#fff', textAlign: 'center', padding: '6px 0', fontSize: 13, fontWeight: 700, fontFamily: "'Noto Sans JP', sans-serif", flexShrink: 0 }}>
          接続が切れました・再接続中…
        </div>
      )}
      {crashState && !bannerDismissed && (
        <CrashBanner
          crashState={crashState}
          categories={categories}
          subcategories={subcategories}
          onSelectCategory={handleCrashSelectCategory}
          onSelectSubcategory={handleCrashSelectSubcategory}
          onDismiss={() => setBannerDismissed(true)}
        />
      )}
      <TickerBar />
      <div className="flex flex-1 overflow-hidden">
        <CategorySidebar
          categories={categories}
          subcategories={subcategories}
          activeCategory={resolvedActiveCategory}
          setActiveCategory={setActiveCategory}
          activeSubcategory={activeSubcategory}
          setActiveSubcategory={setActiveSubcategory}
        />
        <div className="flex-1 flex flex-col overflow-hidden">
          {subcatsForActiveCat.length > 0 && (
            <div
              className="flex gap-2 px-4 py-3 overflow-x-auto scrollbar-none flex-shrink-0"
              style={{ background: '#111118', borderBottom: '1px solid #252532' }}
            >
              <button
                onClick={() => setActiveSubcategory(null)}
                style={{
                  padding: '7px 16px', borderRadius: 20, whiteSpace: 'nowrap',
                  background: activeSubcategory === null ? 'rgba(229,34,51,0.15)' : 'rgba(255,255,255,0.04)',
                  border: activeSubcategory === null ? '1px solid rgba(229,34,51,0.5)' : '1px solid #252532',
                  color: activeSubcategory === null ? '#f0f0f5' : '#7a7a90',
                  fontFamily: "'Noto Sans JP', sans-serif", fontSize: 14, fontWeight: 600,
                  cursor: 'pointer', transition: 'all 0.13s',
                }}
              >
                すべて
              </button>
              {subcatsForActiveCat.map((sub) => (
                <button
                  key={sub.id}
                  onClick={() => setActiveSubcategory(sub.id)}
                  style={{
                    padding: '7px 16px', borderRadius: 20, whiteSpace: 'nowrap',
                    background: activeSubcategory === sub.id ? 'rgba(229,34,51,0.15)' : 'rgba(255,255,255,0.04)',
                    border: activeSubcategory === sub.id ? '1px solid rgba(229,34,51,0.5)' : '1px solid #252532',
                    color: activeSubcategory === sub.id ? '#f0f0f5' : '#7a7a90',
                    fontFamily: "'Noto Sans JP', sans-serif", fontSize: 14, fontWeight: 600,
                    cursor: 'pointer', transition: 'all 0.13s',
                  }}
                >
                  {sub.name}
                </button>
              ))}
            </div>
          )}
          <div className="flex-1 overflow-y-auto scrollbar-dark px-4 py-4">
            <MenuGrid
              menuItems={menuItems}
              categories={categories}
              subcategories={subcategories}
              onAddItem={handleTapItem}
              showImage={true}
              activeCategory={resolvedActiveCategory}
              activeSubcategory={activeSubcategory}
            />
          </div>
        </div>
        <OrderHistoryPanel order={order} chargeAmt={chargeAmt} total={total} itemCount={itemCount} />
      </div>
      {confirmItem && (
        <ConfirmModal
          item={confirmItem}
          livePrice={prices[confirmItem.id]}
          onConfirm={handleConfirmAdd}
          onCancel={() => setConfirmItem(null)}
        />
      )}
      <OrderToast toast={toast} />
    </div>
  );
}
