import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router-dom';

// Bottom nav, sized for one-handed phone use per phase-1.md §5. Five items
// maximum per the design handoff quality floor; today only two are wired
// (Dashboard, Profile). More arrive as the phase list grows.

interface NavItem {
  to: string;
  labelKey: string;
  icon: string;
  end?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', labelKey: 'nav.dashboard', icon: '⌂', end: true },
  { to: '/settings/profile', labelKey: 'nav.profile', icon: '☺' },
];

export function AppShell() {
  const { t } = useTranslation();
  return (
    <div className="app-shell">
      <main className="app-shell__main">
        <Outlet />
      </main>
      <nav className="bottom-nav" aria-label={t('nav.dashboard')}>
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className="bottom-nav__item">
            <span aria-hidden="true" className="bottom-nav__icon">
              {item.icon}
            </span>
            <span>{t(item.labelKey)}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
