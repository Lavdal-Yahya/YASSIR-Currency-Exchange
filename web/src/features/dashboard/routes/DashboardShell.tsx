import { useTranslation } from 'react-i18next';

// Placeholder — real dashboard cards land phase by phase (balances in P3,
// debts in P5, profit in P6, full dashboard in P7). Today's job is proving
// the layout shell (bottom nav, RTL flip, safe-area insets) before anyone
// reads real numbers off it. See phase-1.md §5.

export function DashboardShell() {
  const { t } = useTranslation();
  return (
    <>
      <h1 className="page-title">{t('dashboard.title')}</h1>
      <div className="placeholder-card">{t('dashboard.placeholder_balances')}</div>
    </>
  );
}
