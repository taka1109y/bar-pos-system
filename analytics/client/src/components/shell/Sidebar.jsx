import { NavLink } from 'react-router-dom';
import { cn } from '../ui/cn';

// 分析サイトのサイドバー(w-64 固定)。3ゾーン構成: Header + nav + Footer(mt-auto border-t)。
// ルーティングは react-router の NavLink(aria-current="page" は NavLink が自動付与)。
// 後続フェーズで項目を追加する場合は NAV_GROUPS に追記する(App.jsx の Route も併せて追加)。
const ICONS = {
  dashboard: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" />
    </svg>
  ),
  trend: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 17l6-6 4 4 8-8" /><path d="M15 7h6v6" />
    </svg>
  ),
  time: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" />
    </svg>
  ),
  calendar: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18" />
    </svg>
  ),
  payments: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /><path d="M6 15h4" />
    </svg>
  ),
  compare: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 3L4 7l4 4" /><path d="M4 7h16" /><path d="M16 21l4-4-4-4" /><path d="M20 17H4" />
    </svg>
  ),
  data: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
    </svg>
  ),
  ranking: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 21h18" /><path d="M6 21V11" /><path d="M12 21V4" /><path d="M18 21v-7" />
    </svg>
  ),
  mix: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" /><path d="M12 3v9l6.4 6.3" />
    </svg>
  ),
  productTrend: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 3v18h18" /><path d="M7 14l4-5 3 3 5-7" />
    </svg>
  ),
  affinity: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="12" r="5.5" /><circle cx="15" cy="12" r="5.5" />
    </svg>
  ),
  engineering: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M12 3v18" /><path d="M3 12h18" />
    </svg>
  ),
  guests: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="8" r="3.5" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <path d="M16 5.5a3.5 3.5 0 010 5" /><path d="M17.5 14.5c2.1.8 3.5 2.9 3.5 5.5" />
    </svg>
  ),
  utilization: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 10V6a2 2 0 012-2h8a2 2 0 012 2v4" /><path d="M4 18v-4a2 2 0 012-2h12a2 2 0 012 2v4" /><path d="M4 18h16" /><path d="M6 18v3M18 18v3" />
    </svg>
  ),
  stay: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 3h12M6 21h12" /><path d="M8 3v3l4 4 4-4V3" /><path d="M8 21v-3l4-4 4 4v3" />
    </svg>
  ),
  tags: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2l8.5 8.5a2 2 0 010 2.8L14 20a2 2 0 01-2.8 0L2.7 11.5A2 2 0 012 10V4a2 2 0 012-2h6a2 2 0 011.4.6z" transform="translate(1 1) scale(0.92)" /><circle cx="7.5" cy="7.5" r="1.3" />
    </svg>
  ),
  target: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" />
    </svg>
  ),
  daysInput: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18" /><path d="M9 16l2 2 4-4" />
    </svg>
  ),
  seats: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 11V5a2 2 0 012-2h6a2 2 0 012 2v6" /><path d="M5 21v-6a2 2 0 012-2h10a2 2 0 012 2v6" /><path d="M5 17h14" />
    </svg>
  ),
  closings: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 12h.01M18 12h.01" />
    </svg>
  ),
  expenses: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 2h12v20l-3-2-3 2-3-2-3 2z" /><path d="M9 7h6M9 11h6" />
    </svg>
  ),
  recurring: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 2l4 4-4 4" /><path d="M3 11V9a4 4 0 014-4h14" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v2a4 4 0 01-4 4H3" />
    </svg>
  ),
  shifts: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="7" r="3.5" /><path d="M2 21v-1a6 6 0 0112 0v1" /><circle cx="17.5" cy="15.5" r="4" /><path d="M17.5 14v1.5l1.2 1.2" />
    </svg>
  ),
  plStatement: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6" /><path d="M8 13h8M8 17h5" />
    </svg>
  ),
  breakeven: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 3v18h18" /><path d="M7 17L17 7" /><path d="M7 8l9 9" /><circle cx="12" cy="12.5" r="1.5" />
    </svg>
  ),
  labor: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 12h-4l-3 8-6-16-3 8H2" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 00.34 1.87l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.7 1.7 0 00-1.87-.34 1.7 1.7 0 00-1 1.55V21a2 2 0 11-4 0v-.09a1.7 1.7 0 00-1-1.55 1.7 1.7 0 00-1.87.34l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.7 1.7 0 00.34-1.87 1.7 1.7 0 00-1.55-1H3a2 2 0 110-4h.09a1.7 1.7 0 001.55-1 1.7 1.7 0 00-.34-1.87l-.06-.06a2 2 0 112.83-2.83l.06.06a1.7 1.7 0 001.87.34 1.7 1.7 0 001-1.55V3a2 2 0 114 0v.09a1.7 1.7 0 001 1.55 1.7 1.7 0 001.87-.34l.06-.06a2 2 0 112.83 2.83l-.06.06a1.7 1.7 0 00-.34 1.87 1.7 1.7 0 001.55 1H21a2 2 0 110 4h-.09a1.7 1.7 0 00-1.55 1z" />
    </svg>
  ),
};

export const NAV_GROUPS = [
  { label: '経営', items: [{ to: '/', label: 'ダッシュボード', icon: ICONS.dashboard, end: true }] },
  {
    label: '売上分析',
    items: [
      { to: '/sales/trend',    label: '推移',            icon: ICONS.trend },
      { to: '/sales/time',     label: '曜日×時間帯',     icon: ICONS.time },
      { to: '/sales/calendar', label: 'カレンダー',      icon: ICONS.calendar },
      { to: '/sales/payments', label: '支払・税・取消',  icon: ICONS.payments },
      { to: '/sales/compare',  label: '期間比較',        icon: ICONS.compare },
    ],
  },
  {
    label: '商品分析',
    items: [
      { to: '/products/ranking',     label: 'ランキング&ABC',     icon: ICONS.ranking },
      { to: '/products/mix',         label: 'メニューミックス',   icon: ICONS.mix },
      { to: '/products/trend',       label: '商品推移',           icon: ICONS.productTrend },
      { to: '/products/affinity',    label: '併売分析',           icon: ICONS.affinity },
      { to: '/products/engineering', label: 'メニュー分析(4象限)', icon: ICONS.engineering },
    ],
  },
  {
    label: '客席分析',
    items: [
      { to: '/seats/guests',      label: '客数・客単価', icon: ICONS.guests },
      { to: '/seats/utilization', label: '席稼働・回転', icon: ICONS.utilization },
      { to: '/seats/stay',        label: '滞在時間',     icon: ICONS.stay },
    ],
  },
  { label: '比較', items: [{ to: '/compare/tags', label: 'タグ・天候別', icon: ICONS.tags }] },
  { label: '目標', items: [{ to: '/targets', label: '目標管理', icon: ICONS.target }] },
  {
    label: '損益',
    items: [
      { to: '/pl/statement', label: '月次P&L',    icon: ICONS.plStatement },
      { to: '/pl/breakeven', label: '損益分岐点', icon: ICONS.breakeven },
      { to: '/pl/labor',     label: '人時生産性', icon: ICONS.labor },
    ],
  },
  {
    label: '入力',
    items: [
      { to: '/inputs/days',     label: '営業日ノート・タグ', icon: ICONS.daysInput },
      { to: '/inputs/seats',    label: '席数',               icon: ICONS.seats },
      { to: '/inputs/closings', label: 'レジ精算',           icon: ICONS.closings },
      { to: '/inputs/expenses',  label: '経費',               icon: ICONS.expenses },
      { to: '/inputs/recurring', label: '定期経費',           icon: ICONS.recurring },
      { to: '/inputs/shifts',    label: 'スタッフ・シフト',   icon: ICONS.shifts },
    ],
  },
  { label: '設定', items: [{ to: '/settings-store', label: '店舗設定', icon: ICONS.settings }] },
  { label: 'データ', items: [{ to: '/data', label: '同期・検証', icon: ICONS.data }] },
];

export default function Sidebar() {
  return (
    <aside className="w-64 bg-surface border-r border-line flex-shrink-0 flex flex-col h-screen">
      {/* Header */}
      <div className="h-14 px-4 flex items-center gap-2 border-b border-line flex-shrink-0">
        <span className="w-7 h-7 rounded-md bg-primary-500 text-white inline-flex items-center justify-center text-xs font-bold" aria-hidden="true">F</span>
        <div className="min-w-0 leading-tight">
          <div className="text-sm font-bold text-heading truncate">FANZONE 分析</div>
          <div className="text-2xs text-muted">経営分析サイト</div>
        </div>
      </div>

      {/* nav */}
      <nav aria-label="メインナビゲーション" className="flex-1 overflow-y-auto py-2 px-2">
        {NAV_GROUPS.map((group, gi) => (
          <div key={group.label} className={cn(gi > 0 && 'mt-2 pt-2 border-t border-line')}>
            <p className="px-2 mb-1 mt-1 text-2xs font-semibold text-faint uppercase tracking-wider">{group.label}</p>
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => cn(
                    'flex items-center gap-2.5 px-2.5 h-10 rounded-lg text-sm font-medium transition-colors',
                    isActive ? 'bg-primary-50 text-primary-600' : 'text-body hover:bg-surface-hover hover:text-heading'
                  )}
                >
                  <span className="flex-shrink-0 w-5 h-5 [&>svg]:w-full [&>svg]:h-full">{item.icon}</span>
                  <span className="truncate">{item.label}</span>
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="mt-auto border-t border-line px-4 py-3 text-2xs text-muted flex items-center justify-between">
        <span>読み取り専用(bar_ro)</span>
        <a
          href={`${window.location.protocol}//${window.location.hostname}/`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted hover:text-heading"
        >
          POS 管理 ↗
        </a>
      </div>
    </aside>
  );
}
