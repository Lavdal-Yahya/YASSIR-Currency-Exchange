import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorMessage } from '../../../shared/ui/ErrorMessage';
import { Loading } from '../../../shared/ui/Loading';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { useCurrencies } from '../../currencies/api/useCurrencies';
import { useProfitReport } from '../api/useReports';

// Profit report — P6-01. Owner-only via server permission (PROFIT_VIEW).
// The formula string arrives from the server so backend and frontend
// stay in lockstep on what "net profit" means.

function firstOfCurrentMonth(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
}
function startOfNextMonth(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 1).toISOString();
}

export function ProfitReportPage() {
  const { t } = useTranslation();
  const [from, setFrom] = useState(firstOfCurrentMonth());
  const [to, setTo] = useState(startOfNextMonth());
  const [currencyId, setCurrencyId] = useState<string>('');
  const currencies = useCurrencies();

  const filters = useMemo(
    () => ({ from, to, ...(currencyId ? { currencyId } : {}) }),
    [from, to, currencyId],
  );
  const q = useProfitReport(filters);

  return (
    <>
      <PageHeader title={t('reports.profit_title')} />

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
        <label>
          <span>{t('reports.currency')}</span>
          <select value={currencyId} onChange={(e) => setCurrencyId(e.target.value)}>
            <option value="">{t('reports.all_currencies')}</option>
            {currencies.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code}
              </option>
            ))}
          </select>
        </label>
      </form>

      {q.isLoading ? <Loading /> : null}
      {q.error ? <ErrorMessage error={q.error} /> : null}
      {q.data ? (
        <>
          <section className="report-summary">
            <div className="report-card">
              <dt>{t('reports.gross_profit')}</dt>
              <dd>{q.data.grossProfitMru} MRU</dd>
            </div>
            <div className="report-card">
              <dt>{t('reports.cost_of_currency_sold')}</dt>
              <dd>{q.data.costOfCurrencySoldMru} MRU</dd>
            </div>
            <div className="report-card">
              <dt>{t('reports.realized_fx_gain')}</dt>
              <dd>{q.data.realizedFxGainMru} MRU</dd>
            </div>
            <div className="report-card">
              <dt>{t('reports.expenses')}</dt>
              <dd>{q.data.expensesMru} MRU</dd>
            </div>
            <div className="report-card report-card--total">
              <dt>{t('reports.net_profit')}</dt>
              <dd>{q.data.netProfitMru} MRU</dd>
            </div>
          </section>

          <p className="report-formula" role="note">
            {q.data.formula}
          </p>

          <h3>{t('reports.by_currency')}</h3>
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('reports.currency')}</th>
                <th>{t('reports.revenue')}</th>
                <th>{t('reports.cost_of_currency_sold')}</th>
                <th>{t('reports.gross_profit')}</th>
              </tr>
            </thead>
            <tbody>
              {q.data.byCurrency.map((r) => (
                <tr key={r.currencyId}>
                  <td>{r.currencyCode}</td>
                  <td>{r.revenueMru} MRU</td>
                  <td>{r.costOfCurrencySoldMru} MRU</td>
                  <td>{r.grossProfitMru} MRU</td>
                </tr>
              ))}
              {q.data.byCurrency.length === 0 ? (
                <tr>
                  <td colSpan={4}>{t('reports.no_data')}</td>
                </tr>
              ) : null}
            </tbody>
          </table>

          {q.data.fxByCurrency.length > 0 ? (
            <>
              <h3>{t('reports.fx_by_currency')}</h3>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t('reports.currency')}</th>
                    <th>{t('reports.realized_fx_gain')}</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.fxByCurrency.map((r) => (
                    <tr key={r.currencyId}>
                      <td>{r.currencyCode}</td>
                      <td>{r.realizedPnlMru} MRU</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}

          {q.data.expensesByCategory.length > 0 ? (
            <>
              <h3>{t('reports.expenses_by_category')}</h3>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t('reports.category')}</th>
                    <th>{t('reports.amount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.expensesByCategory.map((r) => (
                    <tr key={r.expenseCategoryId}>
                      <td>{r.expenseCategoryName}</td>
                      <td>{r.amountMru} MRU</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}
        </>
      ) : null}
    </>
  );
}
