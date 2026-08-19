import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { useCurrencies } from '../../currencies/api/useCurrencies';
import { ErrorMessage } from '../../../shared/ui/ErrorMessage';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { useCreateOpeningBalance } from '../api/useOpenings';
import { AMOUNT_RE, RATE_RE, normalizeDecimal } from '../../../shared/lib/numericString';

// Opening currency balance form. The three fields the operator supplies
// map 1:1 to the DTO on the server. Money-shaped inputs stay STRING
// through the wire (D-002); zod just validates the shape.
//
// The warning below the fields is deliberate — it names the go-live
// lock consequence *before* the operator submits, so P3-10's "you can
// only correct this via an owner adjustment after go-live" is not a
// surprise later.

const schema = z.object({
  currencyId: z.string().uuid(),
  quantity: z.string().trim().regex(AMOUNT_RE, { message: 'openings.quantity_invalid' }),
  openingAvgCostMru: z.string().trim().regex(RATE_RE, { message: 'openings.avg_cost_invalid' }),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'openings.date_invalid',
  }),
});

type FormValues = z.infer<typeof schema>;

export function OpeningCurrencyFormPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const currencies = useCurrencies();
  const create = useCreateOpeningBalance();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      currencyId: '',
      quantity: '',
      openingAvgCostMru: '',
      effectiveDate: new Date().toISOString().slice(0, 10),
    },
  });

  async function onSubmit(values: FormValues) {
    await create.mutateAsync({
      ...values,
      quantity: normalizeDecimal(values.quantity),
      openingAvgCostMru: normalizeDecimal(values.openingAvgCostMru),
    });
    navigate('/openings');
  }

  return (
    <>
      <PageHeader title={t('openings.new_currency_title')} />

      <div className="notice notice--info" role="note">
        {t('openings.write_warning')}
      </div>

      <form className="form" onSubmit={handleSubmit(onSubmit)} noValidate>
        <div className="field">
          <label htmlFor="oc-currency">{t('openings.currency')}</label>
          <select id="oc-currency" {...register('currencyId')}>
            <option value="">{t('common.choose')}</option>
            {currencies.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} — {c.name}
              </option>
            ))}
          </select>
          {errors.currencyId ? (
            <p className="field__error">{t('openings.currency_required')}</p>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="oc-qty">{t('openings.quantity')}</label>
          <input
            id="oc-qty"
            {...register('quantity')}
            inputMode="decimal"
            placeholder="0.00"
            aria-invalid={!!errors.quantity}
          />
          {errors.quantity ? (
            <p className="field__error">{t(errors.quantity.message ?? 'form.validation')}</p>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="oc-avg">{t('openings.avg_cost_mru')}</label>
          <input
            id="oc-avg"
            {...register('openingAvgCostMru')}
            inputMode="decimal"
            placeholder="0.00000000"
            aria-invalid={!!errors.openingAvgCostMru}
          />
          <p className="field__hint">{t('openings.avg_cost_hint')}</p>
          {errors.openingAvgCostMru ? (
            <p className="field__error">
              {t(errors.openingAvgCostMru.message ?? 'form.validation')}
            </p>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="oc-date">{t('openings.effective_date')}</label>
          <input
            id="oc-date"
            type="date"
            {...register('effectiveDate')}
            aria-invalid={!!errors.effectiveDate}
          />
        </div>

        {create.error ? <ErrorMessage error={create.error} /> : null}

        <div className="dialog__actions">
          <button type="button" className="btn btn--ghost" onClick={() => navigate('/openings')}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn--primary" disabled={isSubmitting}>
            {t('common.save')}
          </button>
        </div>
      </form>
    </>
  );
}
