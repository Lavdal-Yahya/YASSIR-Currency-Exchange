import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useBalances } from '../../openings/api/useOpenings';
import { BalancesCard } from '../../openings/components/BalancesCard';
import { Loading } from '../../../shared/ui/Loading';
import { ErrorMessage } from '../../../shared/ui/ErrorMessage';
import { PERMISSIONS } from '../../../shared/permissions';
import { useSession } from '../../auth/api/useSession';

// Home dashboard. Renders the balances card grid from P3-11 plus two
// deep links (openings + full balances). The rest of the dashboard —
// debts panel, low-balance rollups, recent activity — lands in P5/P7.

export function DashboardShell() {
  const { t } = useTranslation();
  const q = useBalances();
  const session = useSession();
  const perms = new Set(session.data?.permissions ?? []);
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
        {perms.has(PERMISSIONS.PROFIT_VIEW) ? (
          <Link to="/reports/profit" className="btn btn--ghost">
            {t('reports.profit_title')}
          </Link>
        ) : null}
        {perms.has(PERMISSIONS.AUDIT_READ) ? (
          <>
            <Link to="/reports/user-activity" className="btn btn--ghost">
              {t('reports.user_activity_title')}
            </Link>
            <Link to="/audit" className="btn btn--ghost">
              {t('audit.page_title')}
            </Link>
          </>
        ) : null}
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
