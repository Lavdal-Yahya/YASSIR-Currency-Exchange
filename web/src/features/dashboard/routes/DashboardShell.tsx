import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useBalances } from '../../openings/api/useOpenings';
import { BalancesCard } from '../../openings/components/BalancesCard';
import { Loading } from '../../../shared/ui/Loading';
import { ErrorMessage } from '../../../shared/ui/ErrorMessage';
import { PERMISSIONS } from '../../../shared/permissions';
import { useSession } from '../../auth/api/useSession';
import { useDashboardSummary } from '../../reports/api/useReports';

// Home dashboard. Renders (P7-05):
//   · today's activity summary (purchases/sales counts + totals)
//   · open receivables/payables totals
//   · low-balance chips
//   · quick-nav links (balances, openings, reports, audit)
//   · balances-card grid (unchanged from P3-11)

export function DashboardShell() {
  const { t } = useTranslation();
  const balances = useBalances();
  const summary = useDashboardSummary();
  const session = useSession();
  const perms = new Set(session.data?.permissions ?? []);

  return (
    <>
      <h1 className="page-title">{t('dashboard.title')}</h1>

      {summary.isLoading ? <Loading /> : null}
      {summary.error ? <ErrorMessage error={summary.error} /> : null}
      {summary.data ? (
        <>
          <section className="dashboard-summary" aria-label={t('dashboard.summary_label')}>
            <article className="summary-card">
              <h2 className="summary-card__title">{t('dashboard.today_purchases')}</h2>
              <p className="summary-card__count">{summary.data.todayPurchases.count}</p>
              <p className="summary-card__figure">{summary.data.todayPurchases.totalMru} MRU</p>
            </article>
            <article className="summary-card">
              <h2 className="summary-card__title">{t('dashboard.today_sales')}</h2>
              <p className="summary-card__count">{summary.data.todaySales.count}</p>
              <p className="summary-card__figure">{summary.data.todaySales.totalMru} MRU</p>
            </article>
            <article className="summary-card">
              <h2 className="summary-card__title">{t('dashboard.net_today')}</h2>
              <p className="summary-card__figure">{summary.data.todayNetMru} MRU</p>
            </article>
          </section>

          <section className="dashboard-debts" aria-label={t('dashboard.debts_label')}>
            <div className="summary-card">
              <h2 className="summary-card__title">{t('dashboard.open_receivables')}</h2>
              <p className="summary-card__count">{summary.data.openReceivables.count}</p>
              <p className="summary-card__figure">{summary.data.openReceivables.totalMru} MRU</p>
              {summary.data.openReceivables.hasNonMruDebts ? (
                <p className="summary-card__note">{t('dashboard.non_mru_debts_excluded')}</p>
              ) : null}
            </div>
            <div className="summary-card">
              <h2 className="summary-card__title">{t('dashboard.open_payables')}</h2>
              <p className="summary-card__count">{summary.data.openPayables.count}</p>
              <p className="summary-card__figure">{summary.data.openPayables.totalMru} MRU</p>
              {summary.data.openPayables.hasNonMruDebts ? (
                <p className="summary-card__note">{t('dashboard.non_mru_debts_excluded')}</p>
              ) : null}
            </div>
          </section>

          {summary.data.lowBalanceCurrencies.length > 0 ? (
            <div className="banner banner--warn" role="status">
              {t('dashboard.low_balance_warning', {
                count: summary.data.lowBalanceCurrencies.length,
              })}
              <span className="chip-list">
                {summary.data.lowBalanceCurrencies.map((c) => (
                  <span key={c.code} className="badge badge--warn">
                    {c.code} {c.cachedAmount}
                  </span>
                ))}
              </span>
            </div>
          ) : null}
        </>
      ) : null}

      <div className="dashboard-actions">
        <Link to="/balances" className="btn btn--ghost">
          {t('balances.title')}
        </Link>
        <Link to="/openings" className="btn btn--ghost">
          {t('openings.title')}
        </Link>
        <Link to="/reports/cash-flow" className="btn btn--ghost">
          {t('reports.cash_flow_title')}
        </Link>
        <Link to="/reports/ageing" className="btn btn--ghost">
          {t('reports.ageing_title')}
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

      {balances.isLoading ? <Loading /> : null}
      {balances.error ? <ErrorMessage error={balances.error} /> : null}
      {balances.data && balances.data.length === 0 ? (
        <p className="empty-state">{t('balances.empty')}</p>
      ) : null}
      {balances.data && balances.data.length > 0 ? (
        <ul className="card-list" aria-label={t('balances.title')}>
          {balances.data.map((row) => (
            <li key={row.currencyId}>
              <BalancesCard row={row} />
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
