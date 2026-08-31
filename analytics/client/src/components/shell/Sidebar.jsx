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
  data: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
    </svg>
  ),
};

export const NAV_GROUPS = [
  { label: '経営', items: [{ to: '/', label: 'ダッシュボード', icon: ICONS.dashboard, end: true }] },
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
