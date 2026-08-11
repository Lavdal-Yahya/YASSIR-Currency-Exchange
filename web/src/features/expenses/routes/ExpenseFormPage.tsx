import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { useExpenseCategories } from '../../expense-categories/api/useExpenseCategories';
import { useCurrencies } from '../../currencies/api/useCurrencies';
import { usePaymentMethods } from '../../payment-methods/api/usePaymentMethods';
import { ErrorMessage } from '../../../shared/ui/ErrorMessage';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { useCreateExpense } from '../api/useExpenses';

const AMOUNT_RE = /^\d+(\.\d{1,4})?$/;

const schema = z
  .object({
    expenseCategoryId: z.string().uuid({ message: 'expenses.category_required' }),
    currencyId: z.string().uuid({ message: 'expenses.currency_required' }),
    amount: z.string().trim().regex(AMOUNT_RE, { message: 'expenses.amount_invalid' }),
    paymentMethodId: z.string().uuid({ message: 'expenses.method_required' }),
    paymentMethodNote: z.string().max(500).optional(),
    description: z.string().trim().min(1, { message: 'expenses.description_required' }).max(2000),
    transactionDate: z.string().optional(),
  })
  .transform((v) => ({
    ...v,
    paymentMethodNote: v.paymentMethodNote?.trim() || undefined,
    transactionDate: v.transactionDate || undefined,
  }));

type FormValues = z.input<typeof schema>;

export function ExpenseFormPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const categories = useExpenseCategories();
  const currencies = useCurrencies();
  const methods = usePaymentMethods();
  const create = useCreateExpense();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      expenseCategoryId: '',
      currencyId: '',
      amount: '',
      paymentMethodId: '',
      paymentMethodNote: '',
      description: '',
      transactionDate: new Date().toISOString().slice(0, 10),
    },
  });

  async function onSubmit(values: FormValues) {
    const parsed = schema.parse(values);
    await create.mutateAsync(parsed);
    navigate('/expenses');
  }

  return (
    <>
      <PageHeader title={t('expenses.new_title')} />

      <form className="form" onSubmit={handleSubmit(onSubmit)} noValidate>
        <div className="field">
          <label htmlFor="exp-category">{t('expenses.category')}</label>
          <select id="exp-category" {...register('expenseCategoryId')}>
            <option value="">{t('common.choose')}</option>
            {categories.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {errors.expenseCategoryId ? (
            <p className="field__error">
              {t(errors.expenseCategoryId.message ?? 'form.validation')}
            </p>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="exp-currency">{t('expenses.currency')}</label>
          <select id="exp-currency" {...register('currencyId')}>
            <option value="">{t('common.choose')}</option>
            {currencies.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} — {c.name}
              </option>
            ))}
          </select>
          {errors.currencyId ? (
            <p className="field__error">{t(errors.currencyId.message ?? 'form.validation')}</p>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="exp-amount">{t('expenses.amount')}</label>
          <input
            id="exp-amount"
            {...register('amount')}
            inputMode="decimal"
            placeholder="0.00"
            aria-invalid={!!errors.amount}
          />
          {errors.amount ? (
            <p className="field__error">{t(errors.amount.message ?? 'form.validation')}</p>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="exp-method">{t('expenses.payment_method')}</label>
          <select id="exp-method" {...register('paymentMethodId')}>
            <option value="">{t('common.choose')}</option>
            {methods.data?.map((m) => (
              <option key={m.id} value={m.id}>
                {m.labelFr}
              </option>
            ))}
          </select>
          {errors.paymentMethodId ? (
            <p className="field__error">{t(errors.paymentMethodId.message ?? 'form.validation')}</p>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="exp-note">{t('expenses.method_note')}</label>
          <input
            id="exp-note"
            {...register('paymentMethodNote')}
            maxLength={500}
            placeholder={t('expenses.method_note_hint')}
          />
        </div>

        <div className="field">
          <label htmlFor="exp-description">{t('expenses.description')}</label>
          <textarea
            id="exp-description"
            {...register('description')}
            maxLength={2000}
            rows={3}
            aria-invalid={!!errors.description}
          />
          {errors.description ? (
            <p className="field__error">{t(errors.description.message ?? 'form.validation')}</p>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="exp-date">{t('expenses.date')}</label>
          <input id="exp-date" type="date" {...register('transactionDate')} />
        </div>

        {create.error ? <ErrorMessage error={create.error} /> : null}

        <div className="dialog__actions">
          <button type="button" className="btn btn--ghost" onClick={() => navigate('/expenses')}>
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
