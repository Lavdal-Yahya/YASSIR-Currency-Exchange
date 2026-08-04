import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ErrorMessage } from '../../../shared/ui/ErrorMessage';
import { Loading } from '../../../shared/ui/Loading';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { GoLiveLockNotice } from '../components/GoLiveLockNotice';
import { useOpenings } from '../api/useOpenings';

// Landing page for openings. Shows the balances + debts list plus
// two action buttons for the two forms. The GoLiveLockNotice sits
// at the top once go-live has fired so the operator understands why
// the actions are disabled.

export function OpeningsHomePage() {
  const { t } = useTranslation();
  const q = useOpenings();
  const locked = q.data?.isPostGoLive ?? false;

  return (
    <>
      <PageHeader
        title={t('openings.title')}
        action={
          !locked ? (
            <div className="page-header__actions">
              <Link to="/openings/currency/new" className="btn btn--primary">
                {t('openings.add_currency')}
              </Link>
              <Link to="/openings/debt/new" className="btn btn--secondary">
                {t('openings.add_debt')}
              </Link>
            </div>
          ) : null
        }
      />
      {locked ? <GoLiveLockNotice /> : null}
      {q.isLoading ? <Loading /> : null}
      {q.error ? <ErrorMessage error={q.error} /> : null}

      {q.data ? (
        <>
          <section aria-labelledby="openings-balances-heading">
            <h2 id="openings-balances-heading" className="section-heading">
              {t('openings.currency_openings')}
            </h2>
            {q.data.balances.length === 0 ? (
              <p className="empty-state">{t('openings.balances_empty')}</p>
            ) : (
              <ul className="card-list">
                {q.data.balances.map((b) => (
                  <li key={b.id}>
                    <article className="card-row">
                      <div className="card-row__header">
                        <h3 className="card-row__title">
                          {t('openings.opening_row_title', {
                            defaultValue: 'Opening {{amount}}',
                            amount: b.quantity,
                          })}
                        </h3>
                      </div>
                      <div className="card-row__meta">
                        <span>
                          {t('openings.avg_cost')}: {b.openingAvgCostMru} MRU
                        </span>
                        <span>
                          {t('openings.effective_date')}: {b.effectiveDate}
                        </span>
                      </div>
                    </article>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="openings-debts-heading">
            <h2 id="openings-debts-heading" className="section-heading">
              {t('openings.debt_openings')}
            </h2>
            {q.data.debts.receivables.length === 0 && q.data.debts.payables.length === 0 ? (
              <p className="empty-state">{t('openings.debts_empty')}</p>
            ) : (
              <ul className="card-list">
                {q.data.debts.receivables.map((r) => (
                  <li key={`r-${r.id}`}>
                    <article className="card-row">
                      <div className="card-row__header">
                        <h3 className="card-row__title">{t('openings.receivable')}</h3>
                        <span className="badge">{r.status}</span>
                      </div>
                      <div className="card-row__meta">
                        <span className="card-row__mono">{r.originalAmount}</span>
                      </div>
                    </article>
                  </li>
                ))}
                {q.data.debts.payables.map((p) => (
                  <li key={`p-${p.id}`}>
                    <article className="card-row">
                      <div className="card-row__header">
                        <h3 className="card-row__title">{t('openings.payable')}</h3>
                        <span className="badge">{p.status}</span>
                      </div>
                      <div className="card-row__meta">
                        <span className="card-row__mono">{p.originalAmount}</span>
                      </div>
                    </article>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </>
  );
}
