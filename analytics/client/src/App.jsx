import { Routes, Route, Navigate } from 'react-router-dom';
import Shell from './components/shell/Shell';
import DashboardPage from './pages/DashboardPage';
import DataPage from './pages/DataPage';

// ルーティング。Shell(サイドバー + main)をレイアウトルートにし、各ページは Outlet に描画する。
//   /      … ダッシュボード(経営)
//   /data  … 同期・検証(データ)
// 後続フェーズで項目を追加する場合は Sidebar.jsx の NAV_GROUPS と併せて追加する。
export default function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/data" element={<DataPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
