import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import { ErrorMessage } from '../../../shared/ui/ErrorMessage';
import { Loading } from '../../../shared/ui/Loading';
import { PageHeader } from '../../../shared/ui/PageHeader';
import {
  useCreateCurrency,
  useCurrency,
  useDeactivateCurrency,
  useReactivateCurrency,
  useUpdateCurrency,
} from '../api/useCurrencies';
import { THRESHOLD_RE, normalizeDecimal } from '../../../shared/lib/numericString';

const schema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[A-Z0-9]{3,10}$/, { message: 'currencies.code_invalid' }),
  name: z.string().trim().min(1).max(60),
  symbol: z.string().trim().max(8).optional().or(z.literal('')),
  decimalPlaces: z.coerce.number().int().min(0).max(6),
  lowBalanceThreshold: z
    .string()
    .trim()
    .regex(THRESHOLD_RE, { message: 'currencies.threshold_invalid' })
    .optional()
    .or(z.literal('')),
});

type FormValues = z.infer<typeof schema>;

export function CurrencyFormPage() {
  const { id } = useParams();
  const isEdit = !!id;
  const { t } = useTranslation();
  const navigate = useNavigate();

  const existing = useCurrency(isEdit ? id : undefined);
  const create = useCreateCurrency();
  const update = useUpdateCurrency(id ?? '');
  const deactivate = useDeactivateCurrency(id ?? '');
  const reactivate = useReactivateCurrency(id ?? '');

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { code: '', name: '', symbol: '', decimalPlaces: 2, lowBalanceThreshold: '' },
  });

  useEffect(() => {
    if (existing.data) {
      reset({
        code: existing.data.code,
        name: existing.data.name,
        symbol: existing.data.symbol ?? '',
        decimalPlaces: existing.data.decimalPlaces,
        lowBalanceThreshold: existing.data.lowBalanceThreshold ?? '',
      });
    }
  }, [existing.data, reset]);

  async function onSubmit(values: FormValues) {
    const payload = {
      code: values.code,
      name: values.name,
      symbol: values.symbol && values.symbol.length > 0 ? values.symbol : null,
      decimalPlaces: values.decimalPlaces,
      lowBalanceThreshold:
        values.lowBalanceThreshold && values.lowBalanceThreshold.length > 0
          ? normalizeDecimal(values.lowBalanceThreshold)
          : null,
    };
    try {
      if (isEdit) {
        // Code is not editable on update — strip it.
        const { code: _code, ...rest } = payload;
        void _code;
        await update.mutateAsync(rest);
      } else {
        await create.mutateAsync(payload);
      }
      navigate('/currencies');
    } catch {
      /* rendered via mutation.error below */
    }
  }

  if (isEdit && existing.isLoading) return <Loading />;
  if (isEdit && existing.error) return <ErrorMessage error={existing.error} />;

  const mutationError = create.error ?? update.error ?? deactivate.error ?? reactivate.error;

  return (
    <>
      <PageHeader title={isEdit ? t('currencies.edit') : t('currencies.new')} />
      <form className="stack" onSubmit={handleSubmit(onSubmit)} noValidate>
        <div className="field">
          <label htmlFor="cur-code">{t('currencies.code')}</label>
          <input
            id="cur-code"
            {...register('code')}
            aria-invalid={!!errors.code}
            readOnly={isEdit}
            autoCapitalize="characters"
            spellCheck={false}
          />
          {errors.code ? (
            <p className="field__error">{t(errors.code.message ?? 'form.pin_invalid')}</p>
          ) : null}
          {isEdit ? <p className="field__hint">{t('currencies.code_immutable')}</p> : null}
        </div>

        <div className="field">
          <label htmlFor="cur-name">{t('currencies.name')}</label>
          <input id="cur-name" {...register('name')} aria-invalid={!!errors.name} />
        </div>

        <div className="field">
          <label htmlFor="cur-symbol">{t('currencies.symbol')}</label>
          <input id="cur-symbol" {...register('symbol')} />
        </div>

        <div className="field">
          <label htmlFor="cur-dp">{t('currencies.decimal_places')}</label>
          <input
            id="cur-dp"
            type="number"
            min={0}
            max={6}
            inputMode="numeric"
            {...register('decimalPlaces')}
            aria-invalid={!!errors.decimalPlaces}
          />
          <p className="field__hint">{t('currencies.decimal_places_hint')}</p>
        </div>

        <div className="field">
          <label htmlFor="cur-low">{t('currencies.low_threshold')}</label>
          <input
            id="cur-low"
            {...register('lowBalanceThreshold')}
            inputMode="decimal"
            placeholder="0"
            aria-invalid={!!errors.lowBalanceThreshold}
          />
          {errors.lowBalanceThreshold ? (
            <p className="field__error">
              {t(errors.lowBalanceThreshold.message ?? 'form.pin_invalid')}
            </p>
          ) : null}
        </div>

        {mutationError ? <ErrorMessage error={mutationError} /> : null}

        <div className="dialog__actions">
          <button type="button" className="btn btn--ghost" onClick={() => navigate('/currencies')}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn--primary" disabled={isSubmitting}>
            {t('common.save')}
          </button>
        </div>

        {isEdit && existing.data ? (
          <div className="profile-actions">
            {existing.data.isActive ? (
              <button
                type="button"
                className="btn btn--danger"
                onClick={() => deactivate.mutate()}
                disabled={deactivate.isPending}
              >
                {t('currencies.deactivate')}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => reactivate.mutate()}
                disabled={reactivate.isPending}
              >
                {t('currencies.reactivate')}
              </button>
            )}
          </div>
        ) : null}
      </form>
    </>
  );
}
