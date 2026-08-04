import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { useContacts } from '../../contacts/api/useContacts';
import { useCurrencies } from '../../currencies/api/useCurrencies';
import { ErrorMessage } from '../../../shared/ui/ErrorMessage';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { useCreateOpeningDebt } from '../api/useOpenings';

const schema = z.object({
  contactId: z.string().uuid(),
  currencyId: z.string().uuid(),
  amount: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,4})?$/, { message: 'openings.amount_invalid' }),
  side: z.enum(['receivable', 'payable']),
});

type FormValues = z.infer<typeof schema>;

export function OpeningDebtFormPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const contacts = useContacts();
  const currencies = useCurrencies();
  const create = useCreateOpeningDebt();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { contactId: '', currencyId: '', amount: '', side: 'receivable' },
  });

  async function onSubmit(values: FormValues) {
    await create.mutateAsync(values);
    navigate('/openings');
  }

  return (
    <>
      <PageHeader title={t('openings.new_debt_title')} />

      <div className="notice notice--info" role="note">
        {t('openings.debt_note')}
      </div>

      <form className="form" onSubmit={handleSubmit(onSubmit)} noValidate>
        <fieldset className="field">
          <legend>{t('openings.side')}</legend>
          <label className="radio-row">
            <input type="radio" value="receivable" {...register('side')} />
            {t('openings.side_receivable')}
          </label>
          <label className="radio-row">
            <input type="radio" value="payable" {...register('side')} />
            {t('openings.side_payable')}
          </label>
        </fieldset>

        <div className="field">
          <label htmlFor="od-contact">{t('openings.contact')}</label>
          <select id="od-contact" {...register('contactId')}>
            <option value="">{t('common.choose')}</option>
            {contacts.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {errors.contactId ? (
            <p className="field__error">{t('openings.contact_required')}</p>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="od-currency">{t('openings.currency')}</label>
          <select id="od-currency" {...register('currencyId')}>
            <option value="">{t('common.choose')}</option>
            {currencies.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} — {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="od-amount">{t('openings.amount')}</label>
          <input
            id="od-amount"
            {...register('amount')}
            inputMode="decimal"
            placeholder="0.00"
            aria-invalid={!!errors.amount}
          />
          {errors.amount ? (
            <p className="field__error">{t(errors.amount.message ?? 'form.validation')}</p>
          ) : null}
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
