import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router-dom';
import { PageHeader } from '../../../shared/ui/PageHeader';

const TABS = [
  { to: '/settings/business', labelKey: 'settings.tab_business' },
  { to: '/settings/profile', labelKey: 'settings.tab_profile' },
  { to: '/settings/payment-methods', labelKey: 'settings.tab_payment_methods' },
  { to: '/settings/expense-categories', labelKey: 'settings.tab_expense_categories' },
  { to: '/settings/permissions', labelKey: 'settings.tab_permissions' },
];

export function SettingsLayout() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t('settings.title')} />
      <nav className="tabs" aria-label={t('settings.title')}>
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) => `tabs__item${isActive ? ' is-active' : ''}`}
          >
            {t(tab.labelKey)}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </>
  );
}
