import { useNavigate } from 'react-router-dom';
import { cn } from '../ui/cn';

// 管理画面サイドバー(折りたたみ⇄展開)。presentational: 表示と選択のみ。
// props: navGroups, view, onSelect(id), open(bool), onToggle()
// 折りたたみ時(既定)は w-16 のアイコンのみ、展開時は w-60 でラベル表示。
// 外部/内部リンク(価格ボード・キッチン・テーブル選択)はフッターに固定。

// サイドバー下部リンク(業務画面への遷移)。外部=別タブ、内部=同タブ navigate。
const FOOTER_LINKS = [
  {
    href: '/board', label: '価格ボード', external: true,
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>,
  },
  {
    href: '/kitchen', label: 'キッチン', external: false,
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8h1a4 4 0 0 1 0 8h-1" /><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" /><line x1="6" y1="1" x2="6" y2="4" /><line x1="10" y1="1" x2="10" y2="4" /><line x1="14" y1="1" x2="14" y2="4" /></svg>,
  },
  {
    href: '/table', label: 'テーブル選択', external: false,
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5" /><line x1="12" y1="2" x2="12" y2="4" /><line x1="12" y1="20" x2="12" y2="22" /><line x1="2" y1="12" x2="4" y2="12" /><line x1="20" y1="12" x2="22" y2="12" /></svg>,
  },
];

// 開閉トグル(chevron)。open で ‹、collapsed で ›。
function ToggleIcon({ open }) {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2">
      {open ? <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
            : <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}

export default function Sidebar({ navGroups, view, onSelect, open, onToggle }) {
  const navigate = useNavigate();

  return (
    <aside
      className={cn(
        'bg-surface border-r border-line flex flex-col flex-shrink-0 overflow-hidden transition-[width] duration-200',
        open ? 'w-60' : 'w-16'
      )}
    >
      {/* ブランド + トグル */}
      <div className={cn('flex items-center border-b border-line flex-shrink-0 h-14', open ? 'px-3 justify-between' : 'justify-center')}>
        {open && (
          <div className="flex items-center gap-2 min-w-0">
            <img src="/FANZONE_logo_A1.png" alt="FANZONE" className="h-7 w-auto object-contain" />
            <span className="text-2xs font-semibold text-muted whitespace-nowrap">POS 管理</span>
          </div>
        )}
        <button
          type="button"
          onClick={onToggle}
          aria-label={open ? 'サイドバーを折りたたむ' : 'サイドバーを展開する'}
          aria-expanded={open}
          title={open ? '折りたたむ' : '展開する'}
          className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-muted hover:bg-surface-hover hover:text-heading cursor-pointer flex-shrink-0"
        >
          <ToggleIcon open={open} />
        </button>
      </div>

      {/* ナビゲーション */}
      <nav aria-label="メインナビゲーション" className="flex-1 overflow-y-auto py-2 px-2">
        {navGroups.map((group, gi) => (
          <div key={group.label} className={gi > 0 ? 'mt-2 pt-2 border-t border-line' : ''}>
            {open ? (
              <p className="px-2 mb-1 mt-1 text-2xs font-semibold text-faint uppercase tracking-wider">{group.label}</p>
            ) : (
              gi > 0 ? null : <div className="h-1" />
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = view === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSelect(item.id)}
                    aria-current={active ? 'page' : undefined}
                    aria-label={!open ? item.label : undefined}
                    title={!open ? item.label : undefined}
                    className={cn(
                      'w-full rounded-lg transition-colors flex items-center cursor-pointer',
                      open ? 'gap-2.5 px-2.5 h-10 text-left' : 'justify-center h-10',
                      active ? 'bg-primary-50 text-primary-600' : 'text-body hover:bg-surface-hover hover:text-heading'
                    )}
                  >
                    <span className={cn('flex-shrink-0 [&>svg]:w-full [&>svg]:h-full w-5 h-5', active && 'text-primary-600')}>
                      {item.icon}
                    </span>
                    {open && <span className="text-sm font-medium truncate">{item.label}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {/* フッターリンク */}
        <div className="mt-2 pt-2 border-t border-line space-y-0.5">
          {FOOTER_LINKS.map(({ href, label, icon, external }) => {
            const cls = cn(
              'w-full rounded-lg transition-colors flex items-center cursor-pointer text-muted hover:bg-surface-hover hover:text-heading',
              open ? 'gap-2.5 px-2.5 h-10 text-left' : 'justify-center h-10'
            );
            const inner = (
              <>
                <span className="flex-shrink-0 [&>svg]:w-full [&>svg]:h-full w-5 h-5">{icon}</span>
                {open && <span className="text-sm font-medium flex-1 truncate">{label}</span>}
                {open && external && <span className="text-2xs text-faint">↗</span>}
              </>
            );
            return external ? (
              <a key={href} href={href} target="_blank" rel="noopener noreferrer" className={cls} aria-label={!open ? label : undefined} title={!open ? label : undefined}>
                {inner}
              </a>
            ) : (
              <button key={href} type="button" onClick={() => navigate(href)} className={cls} aria-label={!open ? label : undefined} title={!open ? label : undefined}>
                {inner}
              </button>
            );
          })}
        </div>
      </nav>
    </aside>
  );
}
