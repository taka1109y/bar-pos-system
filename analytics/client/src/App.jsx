import { Routes, Route, Navigate } from 'react-router-dom';
import Shell from './components/shell/Shell';
import DashboardPage from './pages/DashboardPage';
import TrendPage from './pages/TrendPage';
import TimePage from './pages/TimePage';
import CalendarPage from './pages/CalendarPage';
import PaymentsTaxPage from './pages/PaymentsTaxPage';
import ComparePage from './pages/ComparePage';
import DataPage from './pages/DataPage';
import ProductRankingPage from './pages/ProductRankingPage';
import MenuMixPage from './pages/MenuMixPage';
import ProductTrendPage from './pages/ProductTrendPage';
import AffinityPage from './pages/AffinityPage';
import MenuEngineeringPage from './pages/MenuEngineeringPage';
import SeatsGuestsPage from './pages/SeatsGuestsPage';
import SeatsUtilizationPage from './pages/SeatsUtilizationPage';
import SeatsStayPage from './pages/SeatsStayPage';
import TagsComparePage from './pages/TagsComparePage';
import TargetsPage from './pages/TargetsPage';
import InputsDaysPage from './pages/InputsDaysPage';
import InputsSeatsPage from './pages/InputsSeatsPage';
import InputsClosingsPage from './pages/InputsClosingsPage';
import StoreSettingsPage from './pages/StoreSettingsPage';
import ExpensesPage from './pages/ExpensesPage';
import RecurringPage from './pages/RecurringPage';
import ShiftsPage from './pages/ShiftsPage';
import PLStatementPage from './pages/PLStatementPage';
import BreakevenPage from './pages/BreakevenPage';
import LaborPage from './pages/LaborPage';
import PricingEffectPage from './pages/PricingEffectPage';
import CrashWindowsPage from './pages/CrashWindowsPage';
import SeesawPage from './pages/SeesawPage';

// ルーティング。Shell(サイドバー + main)をレイアウトルートにし、各ページは Outlet に描画する。
//   /               … ダッシュボード(経営)
//   /sales/trend    … 推移(粒度・比較・CSV)
//   /sales/time     … 曜日×時間帯(ヒートマップ・曜日別・時間帯別)
//   /sales/calendar … 月次カレンダー(売上濃淡・タグ・天候)
//   /sales/payments … 支払方法・税率別・割引/取消
//   /sales/compare  … 期間A/B比較
//   /products/ranking     … 商品ランキング&ABC(パレート図)
//   /products/mix         … メニューミックス(構成比)
//   /products/trend       … 商品推移(最大10商品の比較)
//   /products/affinity    … 併売分析(同時注文ペア)
//   /products/engineering … メニュー分析(4象限)
//   /seats/guests      … 客数・客単価(組人数・客単価分布)
//   /seats/utilization … 席稼働・回転(卓別集計・タイムライン)
//   /seats/stay        … 滞在時間分布
//   /compare/tags      … タグ・天候別比較
//   /targets           … 目標管理(進捗・月次目標入力)
//   /inputs/days       … 営業日ノート・タグ入力
//   /inputs/seats      … 席数入力
//   /inputs/closings   … レジ精算(現金過不足)入力
//   /inputs/expenses   … 経費入力(科目管理・CSV取込)
//   /inputs/recurring  … 定期経費(毎月の自動計上)
//   /inputs/shifts     … スタッフ・シフト(人件費入力)
//   /pl/statement      … 月次P&L(ウォーターフォール・科目×期間表)
//   /pl/breakeven      … 損益分岐点(BEP図・KPI・人件費の固定費/変動費扱い)
//   /pl/labor          … 人時生産性(人時売上・人時粗利・営業時別)
//   /pricing/effect    … 価格効果(定価比バンド・値引き費用/暴落原資)
//   /pricing/crash     … 暴落分析(暴落区間の売れ行き・直近4週の同曜日/同時間帯比)
//   /pricing/seesaw    … シーソー分析(勝ち/負けの段数・寄り付きの実施記録)
//   /settings-store    … 店舗設定(営業日境界・週開始・年度・ABC閾値)
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
        <Route path="/products/ranking" element={<ProductRankingPage />} />
        <Route path="/products/mix" element={<MenuMixPage />} />
        <Route path="/products/trend" element={<ProductTrendPage />} />
        <Route path="/products/affinity" element={<AffinityPage />} />
        <Route path="/products/engineering" element={<MenuEngineeringPage />} />
        <Route path="/seats/guests" element={<SeatsGuestsPage />} />
        <Route path="/seats/utilization" element={<SeatsUtilizationPage />} />
        <Route path="/seats/stay" element={<SeatsStayPage />} />
        <Route path="/compare/tags" element={<TagsComparePage />} />
        <Route path="/targets" element={<TargetsPage />} />
        <Route path="/inputs/days" element={<InputsDaysPage />} />
        <Route path="/inputs/seats" element={<InputsSeatsPage />} />
        <Route path="/inputs/closings" element={<InputsClosingsPage />} />
        <Route path="/inputs/expenses" element={<ExpensesPage />} />
        <Route path="/inputs/recurring" element={<RecurringPage />} />
        <Route path="/inputs/shifts" element={<ShiftsPage />} />
        <Route path="/pl/statement" element={<PLStatementPage />} />
        <Route path="/pl/breakeven" element={<BreakevenPage />} />
        <Route path="/pl/labor" element={<LaborPage />} />
        <Route path="/pricing/effect" element={<PricingEffectPage />} />
        <Route path="/pricing/crash" element={<CrashWindowsPage />} />
        <Route path="/pricing/seesaw" element={<SeesawPage />} />
        <Route path="/settings-store" element={<StoreSettingsPage />} />
        <Route path="/data" element={<DataPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
