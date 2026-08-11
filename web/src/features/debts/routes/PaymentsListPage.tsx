import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useContacts } from '../../contacts/api/useContacts';
import { useCurrencies } from '../../currencies/api/useCurrencies';
import { ErrorMessage } from '../../../shared/ui/ErrorMessage';
import { Loading } from '../../../shared/ui/Loading';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { usePayments } from '../api/useDebts';

const LIMIT = 25;

const EMPTY = {
  contactId: '',
  currencyId: '',
  direction: '',
  dateFrom: '',
  dateTo: '',
};

// Payments here are the settlement rows: customer payments received and
// supplier payments made. Trades and expenses live on their own list
// pages (spec §22).
export function PaymentsListPage() {
  const { t } = useTranslation();
  const [f, setF] = useState(EMPTY);
  const [page, setPage] = useState(0);

  const contacts = useContacts();
  const currencies = useCurrencies();

  function setField(key: keyof typeof EMPTY, value: string) {
    setPage(0);
    setF((prev) => ({ ...prev, [key]: value }));
  }

  const q = usePayments({
    ...(f.contactId ? { contactId: f.contactId } : {}),
    ...(f.currencyId ? { currencyId: f.currencyId } : {}),
    ...(f.direction ? { direction: f.direction } : {}),
    ...(f.dateFrom ? { dateFrom: f.dateFrom } : {}),
    ...(f.dateTo ? { dateTo: f.dateTo } : {}),
    limit: LIMIT,
    offset: page * LIMIT,
  });

  const hasFilters = Object.values(f).some(Boolean);
  const totalPages = q.data ? Math.max(1, Math.ceil(q.data.total / LIMIT)) : 1;

  return (
    <>
      <PageHeader title={t('payments.title')} />

      <div className="toolbar">
        <select value={f.contactId} onChange={(e) => setField('contactId', e.target.value)}>
          <option value="">{t('common.filter.all_contacts')}</option>
          {contacts.data?.map((c) => (
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

        <select value={f.direction} onChange={(e) => setField('direction', e.target.value)}>
          <option value="">{t('payments.direction_all')}</option>
          <option value="RECEIVED_FROM_CUSTOMER">
            {t('payments.direction.RECEIVED_FROM_CUSTOMER')}
          </option>
          <option value="PAID_TO_SUPPLIER">{t('payments.direction.PAID_TO_SUPPLIER')}</option>
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
        <p className="empty-state">{t('payments.empty')}</p>
      ) : null}
      {q.data && q.data.data.length > 0 ? (
        <ul className="card-list" aria-label={t('payments.title')}>
          {q.data.data.map((p) => {
            const contactName =
              contacts.data?.find((c) => c.id === p.contactId)?.name ?? p.contactId.slice(0, 8);
            const currCode =
              currencies.data?.find((c) => c.id === p.currencyId)?.code ?? p.currencyId.slice(0, 3);
            const isIn = p.direction === 'RECEIVED_FROM_CUSTOMER';
            return (
              <li key={p.id}>
                <div className="card-row">
                  <div className="card-row__header">
                    <h3 className="card-row__title">
                      {p.amount} <span className="card-row__currency">{currCode}</span>
                    </h3>
                    <span className={`badge badge--${isIn ? 'in' : 'out'}`}>
                      {t(`payments.direction.${p.direction}`)}
                    </span>
                  </div>
                  <div className="card-row__meta">
                    <span>{contactName}</span>
                    <span className="card-row__mono">
                      {new Date(p.transactionDate).toLocaleDateString()}
                    </span>
                    {p.status === 'REVERSED' ? (
                      <span className="badge badge--danger">{t('payments.status.REVERSED')}</span>
                    ) : null}
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
