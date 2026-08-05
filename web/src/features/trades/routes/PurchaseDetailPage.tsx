import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { useCurrencies } from '../../currencies/api/useCurrencies';
import { ErrorMessage } from '../../../shared/ui/ErrorMessage';
import { Loading } from '../../../shared/ui/Loading';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { usePurchase } from '../api/useTrades';
import { TradeDetailFigures } from '../components/TradeDetailFigures';

export function PurchaseDetailPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const q = usePurchase(id);
  const currencies = useCurrencies();

  if (q.isLoading || currencies.isLoading) return <Loading />;
  if (q.error) return <ErrorMessage error={q.error} />;
  if (!q.data) return null;

  const p = q.data;
  const delivered = currencies.data?.find((c) => c.id === p.deliveredCurrencyId);
  const payment = currencies.data?.find((c) => c.id === p.paymentCurrencyId);
  const deliveredCode = delivered?.code ?? '—';
  const paymentCode = payment?.code ?? '—';

  return (
    <>
      <PageHeader
        title={`${p.deliveredAmount} ${deliveredCode}`}
        action={
          <span className={`badge badge--${paymentStatusClass(p.paymentStatus)}`}>
            {t(`purchases.payment_status.${p.paymentStatus}`)}
          </span>
        }
      />

      {/* Three-numbers invariant — value, cash, outstanding must never collapse */}
      <TradeDetailFigures
        ns="purchases"
        value={p.paymentTotal}
        valueCurrencyCode={paymentCode}
        cash={p.immediatePayment}
        cashCurrencyCode={paymentCode}
        outstanding={p.outstandingAmount}
        outstandingCurrencyCode={paymentCode}
      />

      <dl className="detail-list">
        <div className="detail-list__row">
          <dt>{t('purchases.figures.value')}</dt>
          <dd>
            {p.deliveredAmount} {deliveredCode}
          </dd>
        </div>
        <div className="detail-list__row">
          <dt>{t('purchases.rate_label')}</dt>
          <dd>
            {t('purchases.rate_direction', {
              from: deliveredCode,
              rate: p.rate,
              to: paymentCode,
            })}
          </dd>
        </div>
        <div className="detail-list__row">
          <dt>{t('purchases.date')}</dt>
          <dd>{new Date(p.transactionDate).toLocaleString()}</dd>
        </div>
        {p.reference ? (
          <div className="detail-list__row">
            <dt>{t('purchases.reference')}</dt>
            <dd>{p.reference}</dd>
          </div>
        ) : null}
        {p.notes ? (
          <div className="detail-list__row">
            <dt>{t('purchases.notes')}</dt>
            <dd>{p.notes}</dd>
          </div>
        ) : null}
      </dl>
    </>
  );
}

function paymentStatusClass(status: string) {
  if (status === 'PAID') return 'in';
  if (status === 'PARTIALLY_PAID') return 'warn';
  return 'danger';
}
