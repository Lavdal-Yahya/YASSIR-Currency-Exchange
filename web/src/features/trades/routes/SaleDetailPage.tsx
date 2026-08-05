import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { useCurrencies } from '../../currencies/api/useCurrencies';
import { ErrorMessage } from '../../../shared/ui/ErrorMessage';
import { Loading } from '../../../shared/ui/Loading';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { useSale } from '../api/useTrades';
import { TradeDetailFigures } from '../components/TradeDetailFigures';

export function SaleDetailPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const q = useSale(id);
  const currencies = useCurrencies();

  if (q.isLoading || currencies.isLoading) return <Loading />;
  if (q.error) return <ErrorMessage error={q.error} />;
  if (!q.data) return null;

  const s = q.data;
  const delivered = currencies.data?.find((c) => c.id === s.deliveredCurrencyId);
  const payment = currencies.data?.find((c) => c.id === s.paymentCurrencyId);
  const deliveredCode = delivered?.code ?? '—';
  const paymentCode = payment?.code ?? '—';

  return (
    <>
      <PageHeader
        title={`${s.deliveredAmount} ${deliveredCode}`}
        action={
          <span className={`badge badge--${paymentStatusClass(s.paymentStatus)}`}>
            {t(`sales.payment_status.${s.paymentStatus}`)}
          </span>
        }
      />

      {/* Three-numbers invariant — value, cash, outstanding must never collapse */}
      <TradeDetailFigures
        ns="sales"
        value={s.paymentTotal}
        valueCurrencyCode={paymentCode}
        cash={s.immediatePayment}
        cashCurrencyCode={paymentCode}
        outstanding={s.outstandingAmount}
        outstandingCurrencyCode={paymentCode}
      />

      <dl className="detail-list">
        <div className="detail-list__row">
          <dt>{t('sales.delivered_amount')}</dt>
          <dd>
            {s.deliveredAmount} {deliveredCode}
          </dd>
        </div>
        <div className="detail-list__row">
          <dt>{t('sales.rate_label')}</dt>
          <dd>
            {t('sales.rate_direction', {
              from: deliveredCode,
              rate: s.rate,
              to: paymentCode,
            })}
          </dd>
        </div>
        <div className="detail-list__row">
          <dt>{t('sales.date')}</dt>
          <dd>{new Date(s.transactionDate).toLocaleString()}</dd>
        </div>
        {/* Profit fields — only visible when server includes them (owner has profit:view) */}
        {s.grossProfitMru !== undefined ? (
          <div className="detail-list__row">
            <dt>{t('sales.gross_profit')}</dt>
            <dd>{s.grossProfitMru} MRU</dd>
          </div>
        ) : null}
        {s.costOfCurrencySoldMru !== undefined ? (
          <div className="detail-list__row">
            <dt>{t('sales.cost_of_sold')}</dt>
            <dd>{s.costOfCurrencySoldMru} MRU</dd>
          </div>
        ) : null}
        {s.recipientName ? (
          <div className="detail-list__row">
            <dt>{t('sales.recipient_name')}</dt>
            <dd>{s.recipientName}</dd>
          </div>
        ) : null}
        {s.destination ? (
          <div className="detail-list__row">
            <dt>{t('sales.destination')}</dt>
            <dd>{s.destination}</dd>
          </div>
        ) : null}
        {s.reference ? (
          <div className="detail-list__row">
            <dt>{t('sales.reference')}</dt>
            <dd>{s.reference}</dd>
          </div>
        ) : null}
        {s.notes ? (
          <div className="detail-list__row">
            <dt>{t('sales.notes')}</dt>
            <dd>{s.notes}</dd>
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
