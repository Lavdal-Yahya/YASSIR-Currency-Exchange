import { NavLink, Outlet } from 'react-router-dom';

// Bottom nav, sized for one-handed phone use per phase-1.md §5. Five items
// maximum per the design handoff quality floor; today only two are wired
// (Dashboard, Profile). More arrive as the phase list grows.
//
// Labels stay in French plain text — i18n arrives P1-13, and this file will
// swap `label` strings for `t('nav.dashboard')` in the same commit that
// introduces the i18n provider.

interface NavItem {
  to: string;
  label: string;
  icon: string;
  end?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Tableau', icon: '⌂', end: true },
  { to: '/settings/profile', label: 'Profil', icon: '☺' },
];

export function AppShell() {
  return (
    <div className="app-shell">
      <main className="app-shell__main">
        <Outlet />
      </main>
      <nav className="bottom-nav" aria-label="Navigation principale">
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className="bottom-nav__item">
            <span aria-hidden="true" className="bottom-nav__icon">
              {item.icon}
            </span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
