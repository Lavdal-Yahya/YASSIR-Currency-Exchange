import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ErrorMessage } from '../../../shared/ui/ErrorMessage';
import { Loading } from '../../../shared/ui/Loading';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { usePurchases } from '../api/useTrades';

export function PurchasesListPage() {
  const { t } = useTranslation();
  const q = usePurchases();

  return (
    <>
      <PageHeader
        title={t('purchases.title')}
        action={
          <Link to="/purchases/new" className="btn btn--primary">
            {t('purchases.new')}
          </Link>
        }
      />
      {q.isLoading ? <Loading /> : null}
      {q.error ? <ErrorMessage error={q.error} /> : null}
      {q.data && q.data.data.length === 0 ? (
        <p className="empty-state">{t('purchases.empty')}</p>
      ) : null}
      {q.data && q.data.data.length > 0 ? (
        <ul className="card-list" aria-label={t('purchases.title')}>
          {q.data.data.map((p) => (
            <li key={p.id}>
              <Link to={`/purchases/${p.id}`} className="card-row">
                <div className="card-row__header">
                  <h2 className="card-row__title">
                    {p.deliveredAmount}{' '}
                    <span className="card-row__currency">{p.deliveredCurrencyId.slice(0, 3)}</span>
                  </h2>
                  <span className={`badge badge--${paymentStatusClass(p.paymentStatus)}`}>
                    {t(`purchases.payment_status.${p.paymentStatus}`)}
                  </span>
                </div>
                <div className="card-row__meta">
                  <span className="card-row__mono">{formatDate(p.transactionDate)}</span>
                  <span>{p.paymentTotal} ←</span>
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
