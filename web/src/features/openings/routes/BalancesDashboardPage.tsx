import { useTranslation } from 'react-i18next';
import { ErrorMessage } from '../../../shared/ui/ErrorMessage';
import { Loading } from '../../../shared/ui/Loading';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { useBalances } from '../api/useOpenings';
import { BalancesCard } from '../components/BalancesCard';

// Not the P7 dashboard — that adds filters, low-balance summary rollups,
// and the ageing view. This page is a single card grid over the
// current cache, wired to prove the read APIs from P3-05 work
// end-to-end from a phone.

export function BalancesDashboardPage() {
  const { t } = useTranslation();
  const q = useBalances();
  return (
    <>
      <PageHeader title={t('balances.title')} />
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
