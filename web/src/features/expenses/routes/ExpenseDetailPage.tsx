import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { PERMISSIONS } from '../../../shared/permissions';
import { ErrorMessage } from '../../../shared/ui/ErrorMessage';
import { Loading } from '../../../shared/ui/Loading';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { useCurrencies } from '../../currencies/api/useCurrencies';
import { useReverseExpense } from '../../reversal/api/useReversal';
import { ReverseButton } from '../../reversal/components/ReverseButton';
import { useExpense } from '../api/useExpenses';

export function ExpenseDetailPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const q = useExpense(id);
  const currencies = useCurrencies();
  const reverse = useReverseExpense();

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorMessage error={q.error} />;
  if (!q.data) return null;

  const e = q.data;
  const currencyCode = currencies.data?.find((c) => c.id === e.currencyId)?.code ?? '—';
  const isReversed = e.status === 'REVERSED';

  return (
    <>
      <PageHeader
        title={`${e.amount} ${currencyCode}`}
        action={
          isReversed ? (
            <span className="badge badge--danger">{t('reversal.status_reversed')}</span>
          ) : (
            <ReverseButton
              permission={PERMISSIONS.REVERSAL_EXPENSE}
              dialogTitle={t('reversal.expense_dialog_title')}
              warnMessage={t('reversal.expense_warning')}
              isPending={reverse.isPending}
              errorMessage={reverse.error ? String(reverse.error) : undefined}
              onConfirm={(reason) => reverse.mutateAsync({ id, reason }).catch(() => undefined)}
            />
          )
        }
      />

      {isReversed ? (
        <p className="banner banner--danger" role="note">
          {t('reversal.reversed_note', { reason: e.reversalReason ?? '' })}
        </p>
      ) : null}

      <dl className="detail-list">
        <div className="detail-list__row">
          <dt>{t('expenses.description')}</dt>
          <dd>{e.description}</dd>
        </div>
        <div className="detail-list__row">
          <dt>{t('expenses.amount')}</dt>
          <dd>
            {e.amount} {currencyCode}
          </dd>
        </div>
        <div className="detail-list__row">
          <dt>{t('expenses.date')}</dt>
          <dd>{new Date(e.transactionDate).toLocaleString()}</dd>
        </div>
      </dl>
    </>
  );
}
