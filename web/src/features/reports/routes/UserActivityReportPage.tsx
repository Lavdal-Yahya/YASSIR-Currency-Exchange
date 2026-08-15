import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorMessage } from '../../../shared/ui/ErrorMessage';
import { Loading } from '../../../shared/ui/Loading';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { useUserActivity } from '../api/useReports';

function firstOfCurrentMonth(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
}
function startOfNextMonth(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 1).toISOString();
}

export function UserActivityReportPage() {
  const { t } = useTranslation();
  const [from, setFrom] = useState(firstOfCurrentMonth());
  const [to, setTo] = useState(startOfNextMonth());
  const filters = useMemo(() => ({ from, to }), [from, to]);
  const q = useUserActivity(filters);

  return (
    <>
      <PageHeader title={t('reports.user_activity_title')} />

      <form className="filter-bar" onSubmit={(e) => e.preventDefault()}>
        <label>
          <span>{t('reports.from')}</span>
          <input
            type="date"
            value={from.slice(0, 10)}
            onChange={(e) => setFrom(new Date(e.target.value).toISOString())}
          />
        </label>
        <label>
          <span>{t('reports.to')}</span>
          <input
            type="date"
            value={to.slice(0, 10)}
            onChange={(e) => setTo(new Date(e.target.value).toISOString())}
          />
        </label>
      </form>

      {q.isLoading ? <Loading /> : null}
      {q.error ? <ErrorMessage error={q.error} /> : null}
      {q.data ? (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('reports.user')}</th>
                <th>{t('reports.purchases')}</th>
                <th>{t('reports.sales')}</th>
                <th>{t('reports.payments')}</th>
                <th>{t('reports.expenses')}</th>
                <th>{t('reports.reversals')}</th>
                <th>{t('reports.failed_logins')}</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((r) => (
                <tr key={r.userId}>
                  <td>{r.fullName}</td>
                  <td>{r.purchasesCreated}</td>
                  <td>{r.salesCreated}</td>
                  <td>{r.paymentsCreated}</td>
                  <td>{r.expensesCreated}</td>
                  <td>{r.reversalsPerformed}</td>
                  <td>{r.failedLogins}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}
