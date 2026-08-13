import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorMessage } from '../../../shared/ui/ErrorMessage';
import { Loading } from '../../../shared/ui/Loading';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { useCashFlowReport } from '../api/useReports';

// Cash-flow report page (P7-06). One row per (payment method, currency)
// pair — no cross-currency addition. Period defaults to the current
// month. CSV download button opens the same endpoint with ?format=csv,
// which streams a `text/csv` attachment.

function firstOfCurrentMonth(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
}
function startOfNextMonth(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 1).toISOString();
}

export function CashFlowReportPage() {
  const { t } = useTranslation();
  const [from, setFrom] = useState(firstOfCurrentMonth());
  const [to, setTo] = useState(startOfNextMonth());
  const filters = useMemo(() => ({ from, to }), [from, to]);
  const q = useCashFlowReport(filters);

  const csvUrl = `/api/v1/reports/cash-flow?from=${filters.from}&to=${filters.to}&format=csv`;

  return (
    <>
      <PageHeader
        title={t('reports.cash_flow_title')}
        action={
          <a className="btn btn--ghost" href={csvUrl} download>
            {t('common.download_csv')}
          </a>
        }
      />

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
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('reports.method')}</th>
              <th>{t('reports.currency')}</th>
              <th>{t('reports.credits')}</th>
              <th>{t('reports.debits')}</th>
              <th>{t('reports.net')}</th>
            </tr>
          </thead>
          <tbody>
            {q.data.methods.length === 0 ? (
              <tr>
                <td colSpan={5}>{t('reports.no_data')}</td>
              </tr>
            ) : null}
            {q.data.methods.flatMap((method) =>
              method.byLeg.map((leg) => {
                const net = (parseFloat(leg.creditsTotal) - parseFloat(leg.debitsTotal)).toFixed(4);
                return (
                  <tr key={`${method.paymentMethodId}-${leg.currencyCode}`}>
                    <td>{method.paymentMethodName}</td>
                    <td>{leg.currencyCode}</td>
                    <td>{leg.creditsTotal}</td>
                    <td>{leg.debitsTotal}</td>
                    <td>{net}</td>
                  </tr>
                );
              }),
            )}
          </tbody>
        </table>
      ) : null}
    </>
  );
}
