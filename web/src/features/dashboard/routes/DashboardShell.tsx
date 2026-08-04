import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useBalances } from '../../openings/api/useOpenings';
import { BalancesCard } from '../../openings/components/BalancesCard';
import { Loading } from '../../../shared/ui/Loading';
import { ErrorMessage } from '../../../shared/ui/ErrorMessage';

// Home dashboard. Renders the balances card grid from P3-11 plus two
// deep links (openings + full balances). The rest of the dashboard —
// debts panel, low-balance rollups, recent activity — lands in P5/P7.

export function DashboardShell() {
  const { t } = useTranslation();
  const q = useBalances();
  return (
    <>
      <h1 className="page-title">{t('dashboard.title')}</h1>

      <div className="dashboard-actions">
        <Link to="/balances" className="btn btn--ghost">
          {t('balances.title')}
        </Link>
        <Link to="/openings" className="btn btn--ghost">
          {t('openings.title')}
        </Link>
      </div>

      {q.isLoading ? <Loading /> : null}
      {q.error ? <ErrorMessage error={q.error} /> : null}
      {q.data && q.data.length === 0 ? <p className="empty-state">{t('balances.empty')}</p> : null}
      {q.data && q.data.length > 0 ? (
        <ul className="card-list" aria-label={t('balances.title')}>
          {q.data.map((row) => (
            <li key={row.currencyId}>
              <BalancesCard row={row} />
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
