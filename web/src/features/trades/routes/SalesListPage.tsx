import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ErrorMessage } from '../../../shared/ui/ErrorMessage';
import { Loading } from '../../../shared/ui/Loading';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { useSales } from '../api/useTrades';

export function SalesListPage() {
  const { t } = useTranslation();
  const q = useSales();

  return (
    <>
      <PageHeader
        title={t('sales.title')}
        action={
          <Link to="/sales/new" className="btn btn--primary">
            {t('sales.new')}
          </Link>
        }
      />
      {q.isLoading ? <Loading /> : null}
      {q.error ? <ErrorMessage error={q.error} /> : null}
      {q.data && q.data.data.length === 0 ? (
        <p className="empty-state">{t('sales.empty')}</p>
      ) : null}
      {q.data && q.data.data.length > 0 ? (
        <ul className="card-list" aria-label={t('sales.title')}>
          {q.data.data.map((s) => (
            <li key={s.id}>
              <Link to={`/sales/${s.id}`} className="card-row">
                <div className="card-row__header">
                  <h2 className="card-row__title">
                    {s.deliveredAmount}{' '}
                    <span className="card-row__currency">{s.deliveredCurrencyId.slice(0, 3)}</span>
                  </h2>
                  <span className={`badge badge--${paymentStatusClass(s.paymentStatus)}`}>
                    {t(`sales.payment_status.${s.paymentStatus}`)}
                  </span>
                </div>
                <div className="card-row__meta">
                  <span className="card-row__mono">{formatDate(s.transactionDate)}</span>
                  <span>{s.paymentTotal} →</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

function paymentStatusClass(status: string) {
  if (status === 'PAID') return 'in';
  if (status === 'PARTIALLY_PAID') return 'warn';
  return 'danger';
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString();
}
