import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useExpenseCategories } from '../../expense-categories/api/useExpenseCategories';
import { useCurrencies } from '../../currencies/api/useCurrencies';
import { ErrorMessage } from '../../../shared/ui/ErrorMessage';
import { Loading } from '../../../shared/ui/Loading';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { useExpenses } from '../api/useExpenses';

const LIMIT = 25;

const EMPTY = {
  expenseCategoryId: '',
  currencyId: '',
  dateFrom: '',
  dateTo: '',
};

export function ExpensesListPage() {
  const { t } = useTranslation();
  const [f, setF] = useState(EMPTY);
  const [page, setPage] = useState(0);

  const categories = useExpenseCategories(true);
  const currencies = useCurrencies();

  function setField(key: keyof typeof EMPTY, value: string) {
    setPage(0);
    setF((prev) => ({ ...prev, [key]: value }));
  }

  const query = {
    ...(f.expenseCategoryId ? { expenseCategoryId: f.expenseCategoryId } : {}),
    ...(f.currencyId ? { currencyId: f.currencyId } : {}),
    ...(f.dateFrom ? { dateFrom: f.dateFrom } : {}),
    ...(f.dateTo ? { dateTo: f.dateTo } : {}),
    limit: LIMIT,
    offset: page * LIMIT,
  };

  const q = useExpenses(query);

  const hasFilters = Object.values(f).some(Boolean);
  const totalPages = q.data ? Math.ceil(q.data.total / LIMIT) : 1;

  return (
    <>
      <PageHeader
        title={t('expenses.title')}
        action={
          <Link to="/expenses/new" className="btn btn--primary">
            {t('expenses.new')}
          </Link>
        }
      />

      <div className="toolbar">
        <select
          value={f.expenseCategoryId}
          onChange={(e) => setField('expenseCategoryId', e.target.value)}
        >
          <option value="">{t('common.filter.all_categories')}</option>
          {categories.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        <select value={f.currencyId} onChange={(e) => setField('currencyId', e.target.value)}>
          <option value="">{t('common.filter.all_currencies')}</option>
          {currencies.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code}
            </option>
          ))}
        </select>

        <input
          type="date"
          value={f.dateFrom}
          onChange={(e) => setField('dateFrom', e.target.value)}
          aria-label={t('common.filter.date_from')}
        />
        <input
          type="date"
          value={f.dateTo}
          onChange={(e) => setField('dateTo', e.target.value)}
          aria-label={t('common.filter.date_to')}
        />

        {hasFilters ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => {
              setF(EMPTY);
              setPage(0);
            }}
          >
            {t('common.reset_filters')}
          </button>
        ) : null}
      </div>

      {q.isLoading ? <Loading /> : null}
      {q.error ? <ErrorMessage error={q.error} /> : null}
      {q.data && q.data.data.length === 0 ? (
        <p className="empty-state">{t('expenses.empty')}</p>
      ) : null}
      {q.data && q.data.data.length > 0 ? (
        <ul className="card-list" aria-label={t('expenses.title')}>
          {q.data.data.map((e) => {
            const catName =
              categories.data?.find((c) => c.id === e.expenseCategoryId)?.name ??
              e.expenseCategoryId.slice(0, 8);
            const currCode =
              currencies.data?.find((c) => c.id === e.currencyId)?.code ?? e.currencyId.slice(0, 3);
            return (
              <li key={e.id}>
                <div className="card-row">
                  <div className="card-row__header">
                    <h2 className="card-row__title">
                      {e.amount} <span className="card-row__currency">{currCode}</span>
                    </h2>
                    <span className="badge badge--danger">{catName}</span>
                  </div>
                  <div className="card-row__meta">
                    <span className="card-row__mono">{formatDate(e.transactionDate)}</span>
                    <span className="card-row__desc">{e.description}</span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {q.data && q.data.total > LIMIT ? (
        <div className="pagination">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => setPage((p) => p - 1)}
            disabled={page === 0}
          >
            {t('common.prev_page')}
          </button>
          <span className="pagination__info">
            {t('common.page_of', { n: page + 1, total: totalPages })}
          </span>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => setPage((p) => p + 1)}
            disabled={page >= totalPages - 1}
          >
            {t('common.next_page')}
          </button>
        </div>
      ) : null}
    </>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString();
}
