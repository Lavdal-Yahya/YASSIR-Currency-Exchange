import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router-dom';
import { PageHeader } from '../../../shared/ui/PageHeader';

const TABS = [
  { to: '/debts/receivables', labelKey: 'debts.tab_receivables' },
  { to: '/debts/payables', labelKey: 'debts.tab_payables' },
];

export function DebtsLayout() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t('debts.title')} />
      <nav className="tabs" aria-label={t('debts.title')}>
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
