import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorMessage } from '../../../shared/ui/ErrorMessage';
import { Loading } from '../../../shared/ui/Loading';
import {
  useCreateExpenseCategory,
  useDeactivateExpenseCategory,
  useExpenseCategories,
  useReactivateExpenseCategory,
  type ExpenseCategory,
} from '../../expense-categories/api/useExpenseCategories';

export function SettingsExpenseCategoriesPage() {
  const { t } = useTranslation();
  const q = useExpenseCategories(true);
  const create = useCreateExpenseCategory();
  const [adding, setAdding] = useState('');

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorMessage error={q.error} />;

  return (
    <>
      <form
        className="toolbar"
        onSubmit={async (e) => {
          e.preventDefault();
          const name = adding.trim();
          if (!name) return;
          await create.mutateAsync({ name });
          setAdding('');
        }}
      >
        <input
          type="text"
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          placeholder={t('settings.expense_categories.name')}
          aria-label={t('settings.expense_categories.name')}
        />
        <button
          type="submit"
          className="btn btn--primary"
          disabled={!adding.trim() || create.isPending}
        >
          {t('settings.expense_categories.add')}
        </button>
      </form>
      {create.error ? <ErrorMessage error={create.error} /> : null}

      <ul className="card-list" aria-label={t('settings.expense_categories.title')}>
        {(q.data ?? []).map((c) => (
          <li key={c.id}>
            <CategoryRow cat={c} />
          </li>
        ))}
      </ul>
    </>
  );
}

function CategoryRow({ cat: c }: { cat: ExpenseCategory }) {
  const { t } = useTranslation();
  const deactivate = useDeactivateExpenseCategory(c.id);
  const reactivate = useReactivateExpenseCategory(c.id);
  return (
    <div className="card-row">
      <div className="card-row__header">
        <h3 className="card-row__title">{c.name}</h3>
        {c.isActive ? (
          <span className="badge badge--in">{t('common.active')}</span>
        ) : (
          <span className="badge">{t('common.inactive')}</span>
        )}
      </div>
      {(deactivate.error ?? reactivate.error) ? (
        <ErrorMessage error={deactivate.error ?? reactivate.error} />
      ) : null}
      <div className="dialog__actions">
        {c.isActive ? (
          <button
            type="button"
            className="btn btn--danger"
            onClick={() => deactivate.mutate()}
            disabled={deactivate.isPending}
          >
            {t('settings.expense_categories.deactivate')}
          </button>
        ) : (
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => reactivate.mutate()}
            disabled={reactivate.isPending}
          >
            {t('settings.expense_categories.reactivate')}
          </button>
        )}
      </div>
    </div>
  );
}
