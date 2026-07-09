import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider, QueryCache, MutationCache, useQuery } from '@tanstack/react-query';
import { api } from './api';
import POSPage from './pages/POSPage';
import BoardPage from './pages/BoardPage';
import TablePage from './pages/TablePage';
import TableSelectPage from './pages/TableSelectPage';
import KitchenPage from './pages/KitchenPage';
import RegisterStartPage from './pages/RegisterStartPage';

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => console.error('[query error]', error),
  }),
  mutationCache: new MutationCache({
    onError: (error) => console.error('[mutation error]', error),
  }),
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
    mutations: {
      // ネットワーク/タイムアウト系のみ最大2回リトライ（非冪等POSTの二重実行を避ける）
      retry: (failureCount, error) => failureCount < 2 && !!error?.isNetwork,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 4000),
    },
  },
});

// ── 共通: system-settings フェッチ（staleTime: 0 で常に最新） ──
function useRegisterOpen() {
  return useQuery({
    queryKey: ['system-settings'],
    queryFn: () => api.getSystemSettings(),
    staleTime: 0,
    retry: 5,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 5000),
    // エラー中は数秒ごとに再取得して自動回復（顧客を締め出さない）
    refetchInterval: (query) => (query.state.status === 'error' ? 3000 : false),
  });
}

// ── ローディング画面 ─────────────────────────────────────────
function FullScreenLoader() {
  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center">
      <span className="text-slate-500 text-sm tracking-widest animate-pulse">LOADING...</span>
    </div>
  );
}

// ── レジオープン前画面（顧客向け） ───────────────────────────
function RegisterClosedScreen() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const timeStr = now.toLocaleTimeString('ja-JP', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center select-none">
      <p className="text-slate-400 text-sm font-medium tracking-[0.3em] uppercase mb-6">
        Order System
      </p>
      <img src="/FANZONE_logo_A2.png" alt="ロゴ" className="h-16 w-auto object-contain mb-10" />
      <div className="tabular-nums font-mono font-thin text-white leading-none mb-8"
        style={{ fontSize: 'clamp(48px, 10vw, 96px)', letterSpacing: '-0.02em' }}
      >
        {timeStr}
      </div>
      <p className="text-slate-300 text-2xl font-bold tracking-wider">
        レジオープン前です
      </p>
      <p className="absolute bottom-6 text-slate-600 text-xs tracking-widest">
        REGISTER CLOSED
      </p>
    </div>
  );
}

// ── ① 管理画面ガード: 未オープン時 → /start ─────────────────
function RequireRegisterOpen({ children }) {
  const { data: settings, isLoading, isError } = useRegisterOpen();
  if (isLoading || (isError && !settings)) return <FullScreenLoader />;
  if (!settings?.register_open) return <Navigate to="/start" replace />;
  return children;
}

// ── ② /start ガード: オープン済み → / ───────────────────────
function RedirectIfOpen({ children }) {
  const { data: settings, isLoading, isError } = useRegisterOpen();
  if (isLoading || (isError && !settings)) return <FullScreenLoader />;
  if (settings?.register_open) return <Navigate to="/" replace />;
  return children;
}

// ── ③ 顧客向けガード: 未オープン時 → 「レジオープン前です」 ─
function PublicGuard({ children }) {
  const { data: settings, isLoading, isError } = useRegisterOpen();
  if (isLoading || (isError && !settings)) return <FullScreenLoader />;
  if (settings && !settings.register_open) return <RegisterClosedScreen />;
  return children;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/start" element={<RedirectIfOpen><RegisterStartPage /></RedirectIfOpen>} />
          <Route path="/"      element={<RequireRegisterOpen><POSPage /></RequireRegisterOpen>} />
          <Route path="/board" element={<PublicGuard><BoardPage /></PublicGuard>} />
          <Route path="/table" element={<PublicGuard><TableSelectPage /></PublicGuard>} />
          <Route path="/table/:tableId" element={<PublicGuard><TablePage /></PublicGuard>} />
          <Route path="/kitchen" element={<PublicGuard><KitchenPage /></PublicGuard>} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
