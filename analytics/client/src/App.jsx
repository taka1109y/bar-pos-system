import { Routes, Route, Navigate } from 'react-router-dom';
import Shell from './components/shell/Shell';
import DashboardPage from './pages/DashboardPage';
import TrendPage from './pages/TrendPage';
import TimePage from './pages/TimePage';
import CalendarPage from './pages/CalendarPage';
import PaymentsTaxPage from './pages/PaymentsTaxPage';
import ComparePage from './pages/ComparePage';
import DataPage from './pages/DataPage';

// ルーティング。Shell(サイドバー + main)をレイアウトルートにし、各ページは Outlet に描画する。
//   /               … ダッシュボード(経営)
//   /sales/trend    … 推移(粒度・比較・CSV)
//   /sales/time     … 曜日×時間帯(ヒートマップ・曜日別・時間帯別)
//   /sales/calendar … 月次カレンダー(売上濃淡・タグ・天候)
//   /sales/payments … 支払方法・税率別・割引/取消
//   /sales/compare  … 期間A/B比較
//   /data           … 同期・検証(データ)
// 項目を追加する場合は Sidebar.jsx の NAV_GROUPS と併せて追加する。
export default function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/sales/trend" element={<TrendPage />} />
        <Route path="/sales/time" element={<TimePage />} />
        <Route path="/sales/calendar" element={<CalendarPage />} />
        <Route path="/sales/payments" element={<PaymentsTaxPage />} />
        <Route path="/sales/compare" element={<ComparePage />} />
        <Route path="/data" element={<DataPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
