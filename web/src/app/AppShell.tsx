import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router-dom';

// Top nav, sized for one-handed phone use. Moved from bottom to top so
// the nav is always visible without scrolling.

interface NavItem {
  to: string;
  labelKey: string;
  icon: string;
  end?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', labelKey: 'nav.dashboard', icon: '⌂', end: true },
  { to: '/purchases', labelKey: 'nav.purchases', icon: '↓' },
  { to: '/sales', labelKey: 'nav.sales', icon: '↑' },
  { to: '/debts', labelKey: 'nav.debts', icon: '⇌' },
  { to: '/contacts', labelKey: 'nav.contacts', icon: '☏' },
  { to: '/settings', labelKey: 'nav.settings', icon: '⚙' },
];

export function AppShell() {
  const { t } = useTranslation();
  return (
    <div className="app-shell">
      <nav className="top-nav" aria-label={t('nav.dashboard')}>
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className="top-nav__item">
            <span aria-hidden="true" className="top-nav__icon">
              {item.icon}
            </span>
            <span className="top-nav__label">{t(item.labelKey)}</span>
          </NavLink>
        ))}
      </nav>
      <main className="app-shell__main">
        <Outlet />
      </main>
    </div>
  );
}
