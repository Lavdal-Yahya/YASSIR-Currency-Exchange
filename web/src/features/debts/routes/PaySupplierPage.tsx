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
import { useCreateSupplierPayment, usePayable } from '../api/useDebts';

const AMOUNT_RE = /^\d+(\.\d{1,4})?$/;

// Mirror of ReceivePaymentPage for the payables side. Non-base
// settlements trigger the FX gain/loss in SupplierPaymentService
// (D-017) — no UI knob needed here.
const schema = z.object({
  amount: z.string().trim().regex(AMOUNT_RE, { message: 'openings.amount_invalid' }),
  paymentMethodId: z.string().uuid({ message: 'form.required' }),
  paymentMethodNote: z.string().max(500).optional(),
  reference: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
  transactionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'openings.date_invalid' }),
});

type FormValues = z.infer<typeof schema>;

export function PaySupplierPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const online = useOnline();
  const { id = '' } = useParams();

  const payable = usePayable(id);
  const contact = useContact(payable.data?.contactId);
  const currencies = useCurrencies();
  const methods = usePaymentMethods();
  const create = useCreateSupplierPayment();

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
    },
  });

  useEffect(() => {
    if (payable.data) {
      setValue('amount', payable.data.outstandingAmount);
    }
  }, [payable.data, setValue]);

  if (payable.isLoading) return <Loading />;
  if (payable.error) return <ErrorMessage error={payable.error} />;
  if (!payable.data) return <p className="empty-state">{t('debts.payable_not_found')}</p>;

  const p = payable.data;
  const currency = currencies.data?.find((c) => c.id === p.currencyId);
  const paymentMethodId = watch('paymentMethodId');
  const selectedMethod = methods.data?.find((m) => m.id === paymentMethodId);
  const needsNote = selectedMethod?.requiresNote ?? false;

  async function onSubmit(values: FormValues) {
    const input = {
      contactId: p.contactId,
      currencyId: p.currencyId,
      amount: values.amount,
      paymentMethodId: values.paymentMethodId,
      ...(values.paymentMethodNote ? { paymentMethodNote: values.paymentMethodNote } : {}),
      ...(values.reference ? { reference: values.reference } : {}),
      ...(values.notes ? { notes: values.notes } : {}),
      transactionDate: new Date(values.transactionDate).toISOString(),
    };
    await create.mutateAsync(input);
    navigate('/debts/payables');
  }

  return (
    <>
      <PageHeader title={t('debts.pay_title')} />

      <div className="card-row">
        <div className="card-row__header">
          <h3 className="card-row__title">
            {p.outstandingAmount}{' '}
            <span className="card-row__currency">{currency?.code ?? p.currencyId.slice(0, 3)}</span>
          </h3>
          <span className="badge badge--warn">{t('debts.outstanding_label')}</span>
        </div>
        <div className="card-row__meta">
          <span>{contact.data?.name ?? '—'}</span>
          <span className="card-row__mono">
            {t('debts.original_amount')}: {p.originalAmount}
          </span>
        </div>
      </div>

      <form className="form" onSubmit={handleSubmit(onSubmit)} noValidate>
        <div className="field">
          <label htmlFor="ps-amount">{t('debts.amount_paid')}</label>
          <input
            id="ps-amount"
            {...register('amount')}
            inputMode="decimal"
            placeholder="0.00"
            aria-invalid={!!errors.amount}
          />
          <p className="field__hint">
            {t('debts.currency_locked', { code: currency?.code ?? p.currencyId.slice(0, 3) })}
          </p>
          {errors.amount ? (
            <p className="field__error">{t(errors.amount.message ?? 'form.validation')}</p>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="ps-method">{t('debts.payment_method')}</label>
          <select id="ps-method" {...register('paymentMethodId')}>
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
            <label htmlFor="ps-note">
              {t('debts.method_note')} <span className="required">*</span>
            </label>
            <input
              id="ps-note"
              {...register('paymentMethodNote', { required: needsNote })}
              maxLength={500}
              placeholder={t('debts.method_note_hint')}
            />
          </div>
        ) : null}

        <div className="field">
          <label htmlFor="ps-ref">{t('debts.reference')}</label>
          <input id="ps-ref" {...register('reference')} maxLength={200} />
        </div>

        <div className="field">
          <label htmlFor="ps-notes">{t('debts.notes')}</label>
          <textarea id="ps-notes" {...register('notes')} rows={3} maxLength={2000} />
        </div>

        <div className="field">
          <label htmlFor="ps-date">{t('debts.date')}</label>
          <input id="ps-date" type="date" {...register('transactionDate')} />
        </div>

        {create.error ? <ErrorMessage error={create.error} /> : null}

        <div className="dialog__actions">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => navigate('/debts/payables')}
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
