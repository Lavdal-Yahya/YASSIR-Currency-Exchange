import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { useContacts } from '../../contacts/api/useContacts';
import { useCurrencies } from '../../currencies/api/useCurrencies';
import { usePaymentMethods } from '../../payment-methods/api/usePaymentMethods';
import { ErrorMessage } from '../../../shared/ui/ErrorMessage';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { useOnline } from '../../../shared/pwa/useOnline';
import { useCreateSale, useLastTradeRate } from '../api/useTrades';

const AMOUNT_RE = /^\d+(\.\d{1,4})?$/;
const RATE_RE = /^\d+(\.\d{1,8})?$/;

const schema = z.object({
  deliveredCurrencyId: z.string().uuid({ message: 'form.required' }),
  deliveredAmount: z.string().trim().regex(AMOUNT_RE, { message: 'openings.quantity_invalid' }),
  paymentCurrencyId: z.string().uuid({ message: 'form.required' }),
  rate: z
    .string()
    .trim()
    .regex(RATE_RE, { message: 'openings.avg_cost_invalid' })
    .optional()
    .or(z.literal('')),
  immediatePayment: z
    .string()
    .trim()
    .regex(AMOUNT_RE, { message: 'openings.quantity_invalid' })
    .optional()
    .or(z.literal('')),
  paymentMethodId: z.string().uuid().optional().or(z.literal('')),
  paymentMethodNote: z.string().max(500).optional(),
  contactId: z.string().uuid().optional().or(z.literal('')),
  recipientName: z.string().max(200).optional(),
  destination: z.string().max(500).optional(),
  reference: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
  transactionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'openings.date_invalid' }),
});

type FormValues = z.infer<typeof schema>;

export function SaleFormPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const online = useOnline();
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [rateSanityDismissed, setRateSanityDismissed] = useState(false);

  const currencies = useCurrencies();
  const methods = usePaymentMethods();
  const contacts = useContacts();
  const create = useCreateSale();

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      deliveredCurrencyId: '',
      deliveredAmount: '',
      paymentCurrencyId: '',
      rate: '',
      immediatePayment: '',
      paymentMethodId: '',
      paymentMethodNote: '',
      contactId: '',
      recipientName: '',
      destination: '',
      reference: '',
      notes: '',
      transactionDate: new Date().toISOString().slice(0, 10),
    },
  });

  const watched = useWatch({ control });
  const deliveredCurrencyId = watched.deliveredCurrencyId;
  const paymentCurrencyId = watched.paymentCurrencyId;
  const deliveredAmount = watched.deliveredAmount ?? '';
  const rate = watched.rate ?? '';
  const immediatePayment = watched.immediatePayment ?? '';
  const paymentMethodId = watched.paymentMethodId ?? '';

  const lastRate = useLastTradeRate(
    deliveredCurrencyId || undefined,
    paymentCurrencyId || undefined,
  );

  const deliveredCurrency = currencies.data?.find((c) => c.id === deliveredCurrencyId);
  const paymentCurrency = currencies.data?.find((c) => c.id === paymentCurrencyId);
  const selectedMethod = methods.data?.find((m) => m.id === paymentMethodId);

  const derivedTotal =
    rate && deliveredAmount && RATE_RE.test(rate) && AMOUNT_RE.test(deliveredAmount)
      ? (parseFloat(rate) * parseFloat(deliveredAmount)).toFixed(2)
      : null;

  const showRateWarning =
    !rateSanityDismissed &&
    !!lastRate &&
    !!rate &&
    RATE_RE.test(rate) &&
    (() => {
      const entered = parseFloat(rate);
      const last = parseFloat(lastRate);
      return last > 0 && (entered > last * 3 || entered < last / 3);
    })();

  async function onSubmit(values: FormValues) {
    const input = {
      deliveredCurrencyId: values.deliveredCurrencyId,
      deliveredAmount: values.deliveredAmount,
      paymentCurrencyId: values.paymentCurrencyId,
      ...(values.rate ? { rate: values.rate } : {}),
      ...(values.immediatePayment ? { immediatePayment: values.immediatePayment } : {}),
      ...(values.paymentMethodId ? { paymentMethodId: values.paymentMethodId } : {}),
      ...(values.paymentMethodNote ? { paymentMethodNote: values.paymentMethodNote } : {}),
      ...(values.contactId ? { contactId: values.contactId } : {}),
      ...(values.recipientName ? { recipientName: values.recipientName } : {}),
      ...(values.destination ? { destination: values.destination } : {}),
      ...(values.reference ? { reference: values.reference } : {}),
      ...(values.notes ? { notes: values.notes } : {}),
      transactionDate: new Date(values.transactionDate).toISOString(),
    };
    const result = await create.mutateAsync({ input, idempotencyKey });
    setIdempotencyKey(crypto.randomUUID());
    navigate(`/sales/${result.id}`);
  }

  const fromCode = deliveredCurrency?.code ?? '—';
  const toCode = paymentCurrency?.code ?? '—';

  return (
    <>
      <PageHeader title={t('sales.new')} />

      <form className="form" onSubmit={handleSubmit(onSubmit)} noValidate>
        {/* Delivered currency */}
        <div className="field">
          <label htmlFor="sf-delivered-currency">{t('sales.from_currency')}</label>
          <select id="sf-delivered-currency" {...register('deliveredCurrencyId')}>
            <option value="">{t('common.choose')}</option>
            {currencies.data
              ?.filter((c) => c.isActive)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.name}
                </option>
              ))}
          </select>
          {errors.deliveredCurrencyId ? <p className="field__error">{t('form.required')}</p> : null}
        </div>

        {/* Delivered amount */}
        <div className="field">
          <label htmlFor="sf-delivered-amount">{t('sales.delivered_amount')}</label>
          <input
            id="sf-delivered-amount"
            {...register('deliveredAmount')}
            inputMode="decimal"
            placeholder="0.00"
            aria-invalid={!!errors.deliveredAmount}
          />
          {errors.deliveredAmount ? (
            <p className="field__error">{t('openings.quantity_invalid')}</p>
          ) : null}
        </div>

        {/* Payment currency */}
        <div className="field">
          <label htmlFor="sf-payment-currency">{t('sales.to_currency')}</label>
          <select id="sf-payment-currency" {...register('paymentCurrencyId')}>
            <option value="">{t('common.choose')}</option>
            {currencies.data
              ?.filter((c) => c.isActive)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.name}
                </option>
              ))}
          </select>
          {errors.paymentCurrencyId ? <p className="field__error">{t('form.required')}</p> : null}
        </div>

        {/* Rate with unmistakable direction */}
        <div className="field">
          <label htmlFor="sf-rate">
            {t('sales.rate_label')}
            {deliveredCurrencyId && paymentCurrencyId ? (
              <span className="field__hint">
                {' '}
                — 1 {fromCode} = ? {toCode}
              </span>
            ) : null}
          </label>
          <input
            id="sf-rate"
            {...register('rate')}
            inputMode="decimal"
            placeholder={t('sales.rate_placeholder')}
            aria-invalid={!!errors.rate}
          />
          {rate && RATE_RE.test(rate) && deliveredCurrencyId && paymentCurrencyId ? (
            <p className="field__hint field__hint--rate">
              {t('sales.rate_direction', { from: fromCode, rate, to: toCode })}
            </p>
          ) : null}
          {showRateWarning ? (
            <div className="notice notice--warn" role="alert">
              {t('sales.rate_warning', {
                from: fromCode,
                last: parseFloat(lastRate ?? '0').toFixed(2),
                to: toCode,
              })}
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setRateSanityDismissed(true)}
              >
                {t('sales.rate_warning_dismiss')}
              </button>
            </div>
          ) : null}
          {errors.rate ? <p className="field__error">{t('openings.avg_cost_invalid')}</p> : null}
        </div>

        {/* Live total preview */}
        {derivedTotal && deliveredAmount && paymentCurrencyId ? (
          <div className="notice notice--info" role="note">
            {t('sales.preview_give')}: {deliveredAmount} {fromCode} &nbsp;|&nbsp;{' '}
            {t('sales.preview_receive')}: {derivedTotal} {toCode}
          </div>
        ) : null}

        {/* Immediate payment */}
        <div className="field">
          <label htmlFor="sf-immediate">{t('sales.immediate_payment')}</label>
          <input
            id="sf-immediate"
            {...register('immediatePayment')}
            inputMode="decimal"
            placeholder="0.00"
          />
        </div>

        {parseFloat(immediatePayment || '0') > 0 ? (
          <div className="field">
            <label htmlFor="sf-method">{t('sales.payment_method')}</label>
            <select id="sf-method" {...register('paymentMethodId')}>
              <option value="">{t('common.choose')}</option>
              {methods.data
                ?.filter((m) => m.isActive)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.labelFr}
                  </option>
                ))}
            </select>
            {selectedMethod?.requiresNote ? (
              <div className="field">
                <label htmlFor="sf-method-note">{t('sales.method_note')}</label>
                <textarea id="sf-method-note" {...register('paymentMethodNote')} rows={2} />
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Contact (optional) */}
        <div className="field">
          <label htmlFor="sf-contact">{t('sales.contact_optional')}</label>
          <select id="sf-contact" {...register('contactId')}>
            <option value="">{t('common.choose')}</option>
            {contacts.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {/* Sale-specific: recipient and destination */}
        <div className="field">
          <label htmlFor="sf-recipient">{t('sales.recipient_name')}</label>
          <input id="sf-recipient" {...register('recipientName')} maxLength={200} />
        </div>
        <div className="field">
          <label htmlFor="sf-destination">{t('sales.destination')}</label>
          <input id="sf-destination" {...register('destination')} maxLength={500} />
        </div>

        {/* Reference */}
        <div className="field">
          <label htmlFor="sf-ref">{t('sales.reference')}</label>
          <input id="sf-ref" {...register('reference')} maxLength={200} />
        </div>

        {/* Notes */}
        <div className="field">
          <label htmlFor="sf-notes">{t('sales.notes')}</label>
          <textarea id="sf-notes" {...register('notes')} rows={3} maxLength={2000} />
        </div>

        {/* Transaction date */}
        <div className="field">
          <label htmlFor="sf-date">{t('sales.date')}</label>
          <input id="sf-date" type="date" {...register('transactionDate')} />
        </div>

        {create.error ? <ErrorMessage error={create.error} /> : null}

        <div className="dialog__actions">
          <button type="button" className="btn btn--ghost" onClick={() => navigate('/sales')}>
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            className="btn btn--primary"
            disabled={isSubmitting || !online}
            title={!online ? t('sales.offline_submit') : undefined}
          >
            {t('common.save')}
          </button>
        </div>
      </form>
    </>
  );
}
