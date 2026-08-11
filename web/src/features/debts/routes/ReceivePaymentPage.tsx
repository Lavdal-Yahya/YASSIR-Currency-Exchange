import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import { useContact } from '../../contacts/api/useContacts';
import { useCurrencies } from '../../currencies/api/useCurrencies';
import { usePaymentMethods } from '../../payment-methods/api/usePaymentMethods';
import { ErrorMessage } from '../../../shared/ui/ErrorMessage';
import { Loading } from '../../../shared/ui/Loading';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { useOnline } from '../../../shared/pwa/useOnline';
import { useCreateCustomerPayment, useReceivable } from '../api/useDebts';

const AMOUNT_RE = /^\d+(\.\d{1,4})?$/;

// Single-target in v1 per D-011: this page settles exactly one receivable.
// The service accepts N — the UI defers multi-target until requested.
// Currency is locked to the target (spec §15.2 cross-currency ban).
const schema = z.object({
  amount: z.string().trim().regex(AMOUNT_RE, { message: 'openings.amount_invalid' }),
  paymentMethodId: z.string().uuid({ message: 'form.required' }),
  paymentMethodNote: z.string().max(500).optional(),
  reference: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
  transactionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'openings.date_invalid' }),
  unitCostMru: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

export function ReceivePaymentPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const online = useOnline();
  const { id = '' } = useParams();

  const receivable = useReceivable(id);
  const contact = useContact(receivable.data?.contactId);
  const currencies = useCurrencies();
  const methods = usePaymentMethods();
  const create = useCreateCustomerPayment();

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      amount: '',
      paymentMethodId: '',
      paymentMethodNote: '',
      reference: '',
      notes: '',
      transactionDate: new Date().toISOString().slice(0, 10),
      unitCostMru: '',
    },
  });

  // Default amount to outstanding once the receivable loads.
  useEffect(() => {
    if (receivable.data) {
      setValue('amount', receivable.data.outstandingAmount);
    }
  }, [receivable.data, setValue]);

  if (receivable.isLoading) return <Loading />;
  if (receivable.error) return <ErrorMessage error={receivable.error} />;
  if (!receivable.data) return <p className="empty-state">{t('debts.receivable_not_found')}</p>;

  const r = receivable.data;
  const currency = currencies.data?.find((c) => c.id === r.currencyId);
  const paymentMethodId = watch('paymentMethodId');
  const selectedMethod = methods.data?.find((m) => m.id === paymentMethodId);
  const needsNote = selectedMethod?.requiresNote ?? false;

  async function onSubmit(values: FormValues) {
    const input = {
      contactId: r.contactId,
      currencyId: r.currencyId,
      amount: values.amount,
      paymentMethodId: values.paymentMethodId,
      ...(values.paymentMethodNote ? { paymentMethodNote: values.paymentMethodNote } : {}),
      ...(values.reference ? { reference: values.reference } : {}),
      ...(values.notes ? { notes: values.notes } : {}),
      ...(values.unitCostMru ? { unitCostMru: values.unitCostMru } : {}),
      transactionDate: new Date(values.transactionDate).toISOString(),
    };
    await create.mutateAsync(input);
    navigate('/debts/receivables');
  }

  return (
    <>
      <PageHeader title={t('debts.receive_title')} />

      <div className="card-row">
        <div className="card-row__header">
          <h3 className="card-row__title">
            {r.outstandingAmount}{' '}
            <span className="card-row__currency">{currency?.code ?? r.currencyId.slice(0, 3)}</span>
          </h3>
          <span className="badge badge--warn">{t('debts.outstanding_label')}</span>
        </div>
        <div className="card-row__meta">
          <span>{contact.data?.name ?? '—'}</span>
          <span className="card-row__mono">
            {t('debts.original_amount')}: {r.originalAmount}
          </span>
        </div>
      </div>

      <form className="form" onSubmit={handleSubmit(onSubmit)} noValidate>
        <div className="field">
          <label htmlFor="rp-amount">{t('debts.amount_received')}</label>
          <input
            id="rp-amount"
            {...register('amount')}
            inputMode="decimal"
            placeholder="0.00"
            aria-invalid={!!errors.amount}
          />
          <p className="field__hint">
            {t('debts.currency_locked', { code: currency?.code ?? r.currencyId.slice(0, 3) })}
          </p>
          {errors.amount ? (
            <p className="field__error">{t(errors.amount.message ?? 'form.validation')}</p>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="rp-method">{t('debts.payment_method')}</label>
          <select id="rp-method" {...register('paymentMethodId')}>
            <option value="">{t('common.choose')}</option>
            {methods.data
              ?.filter((m) => m.isActive)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.labelFr}
                </option>
              ))}
          </select>
          {errors.paymentMethodId ? <p className="field__error">{t('form.required')}</p> : null}
        </div>

        {needsNote ? (
          <div className="field">
            <label htmlFor="rp-note">
              {t('debts.method_note')} <span className="required">*</span>
            </label>
            <input
              id="rp-note"
              {...register('paymentMethodNote', { required: needsNote })}
              maxLength={500}
              placeholder={t('debts.method_note_hint')}
            />
          </div>
        ) : null}

        <div className="field">
          <label htmlFor="rp-ref">{t('debts.reference')}</label>
          <input id="rp-ref" {...register('reference')} maxLength={200} />
        </div>

        <div className="field">
          <label htmlFor="rp-notes">{t('debts.notes')}</label>
          <textarea id="rp-notes" {...register('notes')} rows={3} maxLength={2000} />
        </div>

        <div className="field">
          <label htmlFor="rp-date">{t('debts.date')}</label>
          <input id="rp-date" type="date" {...register('transactionDate')} />
        </div>

        {create.error ? <ErrorMessage error={create.error} /> : null}

        <div className="dialog__actions">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => navigate('/debts/receivables')}
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            className="btn btn--primary"
            disabled={isSubmitting || !online}
            title={!online ? t('debts.offline_submit') : undefined}
          >
            {t('common.save')}
          </button>
        </div>
      </form>
    </>
  );
}
