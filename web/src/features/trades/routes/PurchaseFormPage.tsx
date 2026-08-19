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
import { suggestedRate } from '../../rates/api/suggestion';
import { useCurrentRates } from '../../rates/api/useRates';
import { useCreatePurchase, useLastTradeRate } from '../api/useTrades';
import { AMOUNT_RE, RATE_RE, normalizeDecimal } from '../../../shared/lib/numericString';

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
  reference: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
  transactionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'openings.date_invalid' }),
});

type FormValues = z.infer<typeof schema>;

export function PurchaseFormPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const online = useOnline();
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [rateSanityDismissed, setRateSanityDismissed] = useState(false);

  const currencies = useCurrencies();
  const methods = usePaymentMethods();
  const contacts = useContacts();
  const create = useCreatePurchase();

  const {
    register,
    handleSubmit,
    control,
    setValue,
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
  const currentRates = useCurrentRates();

  const deliveredCurrency = currencies.data?.find((c) => c.id === deliveredCurrencyId);
  const paymentCurrency = currencies.data?.find((c) => c.id === paymentCurrencyId);
  const selectedMethod = methods.data?.find((m) => m.id === paymentMethodId);

  const suggestion = suggestedRate({
    rates: currentRates.data,
    deliveredCode: deliveredCurrency?.code,
    paymentCode: paymentCurrency?.code,
    baseCode: 'MRU',
  });

  // Derived total preview from rate × deliveredAmount.
  const normRate = normalizeDecimal(rate);
  const normAmount = normalizeDecimal(deliveredAmount);
  const derivedTotal =
    normRate && normAmount && RATE_RE.test(normRate) && AMOUNT_RE.test(normAmount)
      ? (parseFloat(normRate) * parseFloat(normAmount)).toFixed(2)
      : null;

  // Reversed-rate warning: entered rate is >3x or <1/3 of last known rate.
  const showRateWarning =
    !rateSanityDismissed &&
    !!lastRate &&
    !!normRate &&
    RATE_RE.test(normRate) &&
    (() => {
      const entered = parseFloat(normRate);
      const last = parseFloat(lastRate);
      return last > 0 && (entered > last * 3 || entered < last / 3);
    })();

  async function onSubmit(values: FormValues) {
    const input = {
      deliveredCurrencyId: values.deliveredCurrencyId,
      deliveredAmount: normalizeDecimal(values.deliveredAmount),
      paymentCurrencyId: values.paymentCurrencyId,
      ...(values.rate ? { rate: normalizeDecimal(values.rate) } : {}),
      ...(values.immediatePayment
        ? { immediatePayment: normalizeDecimal(values.immediatePayment) }
        : {}),
      ...(values.paymentMethodId ? { paymentMethodId: values.paymentMethodId } : {}),
      ...(values.paymentMethodNote ? { paymentMethodNote: values.paymentMethodNote } : {}),
      ...(values.contactId ? { contactId: values.contactId } : {}),
      ...(values.reference ? { reference: values.reference } : {}),
      ...(values.notes ? { notes: values.notes } : {}),
      transactionDate: new Date(values.transactionDate).toISOString(),
    };
    const result = await create.mutateAsync({ input, idempotencyKey });
    setIdempotencyKey(crypto.randomUUID());
    navigate(`/purchases/${result.id}`);
  }

  const fromCode = deliveredCurrency?.code ?? '—';
  const toCode = paymentCurrency?.code ?? '—';

  return (
    <>
      <PageHeader title={t('purchases.new')} />

      <form className="form" onSubmit={handleSubmit(onSubmit)} noValidate>
        {/* Delivered currency */}
        <div className="field">
          <label htmlFor="pf-delivered-currency">{t('purchases.from_currency')}</label>
          <select id="pf-delivered-currency" {...register('deliveredCurrencyId')}>
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
          <label htmlFor="pf-delivered-amount">{t('purchases.delivered_amount')}</label>
          <input
            id="pf-delivered-amount"
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
          <label htmlFor="pf-payment-currency">{t('purchases.to_currency')}</label>
          <select id="pf-payment-currency" {...register('paymentCurrencyId')}>
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

        {/* Rate with unmistakable direction label */}
        <div className="field">
          <label htmlFor="pf-rate">
            {t('purchases.rate_label')}
            {deliveredCurrencyId && paymentCurrencyId ? (
              <span className="field__hint">
                {' '}
                — 1 {fromCode} = ? {toCode}
              </span>
            ) : null}
          </label>
          <input
            id="pf-rate"
            {...register('rate')}
            inputMode="decimal"
            placeholder={t('purchases.rate_placeholder')}
            aria-invalid={!!errors.rate}
          />
          {/* Market-rate suggestion chip (P8-05). Never validated — spec §21.2. */}
          {suggestion ? (
            <button
              type="button"
              className="chip chip--suggest"
              onClick={() => setValue('rate', suggestion.value, { shouldValidate: true })}
              title={`${t('rates.source')}: ${suggestion.source}`}
            >
              {t('rates.suggested_rate', { rate: suggestion.value })}
            </button>
          ) : null}
          {/* Live rate direction display */}
          {normRate && RATE_RE.test(normRate) && deliveredCurrencyId && paymentCurrencyId ? (
            <p className="field__hint field__hint--rate">
              {t('purchases.rate_direction', { from: fromCode, rate: normRate, to: toCode })}
            </p>
          ) : null}
          {/* Reversed-rate sanity warning */}
          {showRateWarning && lastRate ? (
            <div className="notice notice--warn" role="alert">
              {t('purchases.rate_warning', {
                from: fromCode,
                last: parseFloat(lastRate).toFixed(2),
                to: toCode,
              })}
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setRateSanityDismissed(true)}
              >
                {t('purchases.rate_warning_dismiss')}
              </button>
            </div>
          ) : null}
          {errors.rate ? <p className="field__error">{t('openings.avg_cost_invalid')}</p> : null}
        </div>

        {/* Live total preview */}
        {derivedTotal && deliveredAmount && paymentCurrencyId ? (
          <div className="notice notice--info" role="note">
            {t('purchases.preview_receive')}: {deliveredAmount} {fromCode} &nbsp;|&nbsp;{' '}
            {t('purchases.preview_pay')}: {derivedTotal} {toCode}
          </div>
        ) : null}

        {/* Immediate payment */}
        <div className="field">
          <label htmlFor="pf-immediate">{t('purchases.immediate_payment')}</label>
          <input
            id="pf-immediate"
            {...register('immediatePayment')}
            inputMode="decimal"
            placeholder="0.00"
          />
        </div>

        {/* Payment method — required when immediatePayment > 0 */}
        {parseFloat(immediatePayment || '0') > 0 ? (
          <div className="field">
            <label htmlFor="pf-method">{t('purchases.payment_method')}</label>
            <select id="pf-method" {...register('paymentMethodId')}>
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
                <label htmlFor="pf-method-note">{t('purchases.method_note')}</label>
                <textarea id="pf-method-note" {...register('paymentMethodNote')} rows={2} />
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Contact (optional) */}
        <div className="field">
          <label htmlFor="pf-contact">{t('purchases.contact_optional')}</label>
          <select id="pf-contact" {...register('contactId')}>
            <option value="">{t('common.choose')}</option>
            {contacts.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {/* Reference */}
        <div className="field">
          <label htmlFor="pf-ref">{t('purchases.reference')}</label>
          <input id="pf-ref" {...register('reference')} maxLength={200} />
        </div>

        {/* Notes */}
        <div className="field">
          <label htmlFor="pf-notes">{t('purchases.notes')}</label>
          <textarea id="pf-notes" {...register('notes')} rows={3} maxLength={2000} />
        </div>

        {/* Transaction date */}
        <div className="field">
          <label htmlFor="pf-date">{t('purchases.date')}</label>
          <input id="pf-date" type="date" {...register('transactionDate')} />
        </div>

        {create.error ? <ErrorMessage error={create.error} /> : null}

        <div className="dialog__actions">
          <button type="button" className="btn btn--ghost" onClick={() => navigate('/purchases')}>
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            className="btn btn--primary"
            disabled={isSubmitting || !online}
            title={!online ? t('purchases.offline_submit') : undefined}
          >
            {t('common.save')}
          </button>
        </div>
      </form>
    </>
  );
}
