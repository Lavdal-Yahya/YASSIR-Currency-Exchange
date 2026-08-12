import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { PERMISSIONS } from '../../../shared/permissions';
import { ErrorMessage } from '../../../shared/ui/ErrorMessage';
import { Loading } from '../../../shared/ui/Loading';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { useCurrencies } from '../../currencies/api/useCurrencies';
import { useReversePayment } from '../../reversal/api/useReversal';
import { ReverseButton } from '../../reversal/components/ReverseButton';
import { usePayment } from '../api/useDebts';

export function PaymentDetailPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const q = usePayment(id);
  const currencies = useCurrencies();
  const reverse = useReversePayment();

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorMessage error={q.error} />;
  if (!q.data) return null;

  const p = q.data;
  const currencyCode = currencies.data?.find((c) => c.id === p.currencyId)?.code ?? '—';
  const isReversed = p.status === 'REVERSED';

  return (
    <>
      <PageHeader
        title={`${p.amount} ${currencyCode}`}
        action={
          isReversed ? (
            <span className="badge badge--danger">{t('reversal.status_reversed')}</span>
          ) : (
            <ReverseButton
              permission={PERMISSIONS.REVERSAL_PAYMENT}
              dialogTitle={t('reversal.payment_dialog_title')}
              warnMessage={t('reversal.payment_warning')}
              isPending={reverse.isPending}
              errorMessage={reverse.error ? String(reverse.error) : undefined}
              onConfirm={(reason) => reverse.mutateAsync({ id, reason }).catch(() => undefined)}
            />
          )
        }
      />

      {isReversed ? (
        <p className="banner banner--danger" role="note">
          {t('reversal.reversed_note', { reason: p.reversalReason ?? '' })}
        </p>
      ) : null}

      <dl className="detail-list">
        <div className="detail-list__row">
          <dt>{t('payments.direction')}</dt>
          <dd>{t(`payments.direction_${p.direction}`)}</dd>
        </div>
        <div className="detail-list__row">
          <dt>{t('payments.amount')}</dt>
          <dd>
            {p.amount} {currencyCode}
          </dd>
        </div>
        <div className="detail-list__row">
          <dt>{t('payments.date')}</dt>
          <dd>{new Date(p.transactionDate).toLocaleString()}</dd>
        </div>
        {p.reference ? (
          <div className="detail-list__row">
            <dt>{t('payments.reference')}</dt>
            <dd>{p.reference}</dd>
          </div>
        ) : null}
        {p.notes ? (
          <div className="detail-list__row">
            <dt>{t('payments.notes')}</dt>
            <dd>{p.notes}</dd>
          </div>
        ) : null}
      </dl>
    </>
  );
}
