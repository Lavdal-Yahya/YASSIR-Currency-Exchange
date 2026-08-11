import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useContacts } from '../../contacts/api/useContacts';
import { useCurrencies } from '../../currencies/api/useCurrencies';
import { ErrorMessage } from '../../../shared/ui/ErrorMessage';
import { Loading } from '../../../shared/ui/Loading';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { useSales } from '../api/useTrades';

const LIMIT = 25;

const EMPTY: Record<string, string> = {
  status: '',
  paymentStatus: '',
  currencyId: '',
  contactId: '',
  dateFrom: '',
  dateTo: '',
};

export function SalesListPage() {
  const { t } = useTranslation();
  const [f, setF] = useState(EMPTY);
  const [page, setPage] = useState(0);

  const currencies = useCurrencies();
  const contacts = useContacts();

  function setField(key: string, value: string) {
    setPage(0);
    setF((prev) => ({ ...prev, [key]: value }));
  }

  const query = {
    ...(f.status ? { status: f.status } : {}),
    ...(f.paymentStatus ? { paymentStatus: f.paymentStatus } : {}),
    ...(f.currencyId ? { currencyId: f.currencyId } : {}),
    ...(f.contactId ? { contactId: f.contactId } : {}),
    ...(f.dateFrom ? { dateFrom: f.dateFrom } : {}),
    ...(f.dateTo ? { dateTo: f.dateTo } : {}),
    limit: LIMIT,
    offset: page * LIMIT,
  };

  const q = useSales(query);

  const hasFilters = Object.values(f).some(Boolean);
  const totalPages = q.data ? Math.ceil(q.data.total / LIMIT) : 1;

  return (
    <>
      <PageHeader
        title={t('sales.title')}
        action={
          <Link to="/sales/new" className="btn btn--primary">
            {t('sales.new')}
          </Link>
        }
      />

      <div className="toolbar">
        <select value={f.status} onChange={(e) => setField('status', e.target.value)}>
          <option value="">{t('common.filter.all_statuses')}</option>
          <option value="CONFIRMED">{t('sales.status.CONFIRMED')}</option>
          <option value="CANCELLED">{t('sales.status.CANCELLED')}</option>
          <option value="REVERSED">{t('sales.status.REVERSED')}</option>
        </select>

        <select value={f.paymentStatus} onChange={(e) => setField('paymentStatus', e.target.value)}>
          <option value="">{t('common.filter.all_payment_statuses')}</option>
          <option value="UNPAID">{t('sales.payment_status.UNPAID')}</option>
          <option value="PARTIALLY_PAID">{t('sales.payment_status.PARTIALLY_PAID')}</option>
          <option value="PAID">{t('sales.payment_status.PAID')}</option>
        </select>

        <select value={f.currencyId} onChange={(e) => setField('currencyId', e.target.value)}>
          <option value="">{t('common.filter.all_currencies')}</option>
          {currencies.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code}
            </option>
          ))}
        </select>

        <select value={f.contactId} onChange={(e) => setField('contactId', e.target.value)}>
          <option value="">{t('common.filter.all_contacts')}</option>
          {contacts.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
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
        <p className="empty-state">{t('sales.empty')}</p>
      ) : null}
      {q.data && q.data.data.length > 0 ? (
        <ul className="card-list" aria-label={t('sales.title')}>
          {q.data.data.map((s) => (
            <li key={s.id}>
              <Link to={`/sales/${s.id}`} className="card-row">
                <div className="card-row__header">
                  <h2 className="card-row__title">
                    {s.deliveredAmount}{' '}
                    <span className="card-row__currency">
                      {currencies.data?.find((c) => c.id === s.deliveredCurrencyId)?.code ??
                        s.deliveredCurrencyId.slice(0, 3)}
                    </span>
                  </h2>
                  <span className={`badge badge--${paymentStatusClass(s.paymentStatus)}`}>
                    {t(`sales.payment_status.${s.paymentStatus}`)}
                  </span>
                </div>
                <div className="card-row__meta">
                  <span className="card-row__mono">{formatDate(s.transactionDate)}</span>
                  <span>{s.paymentTotal} →</span>
                </div>
              </Link>
            </li>
          ))}
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

function paymentStatusClass(status: string) {
  if (status === 'PAID') return 'in';
  if (status === 'PARTIALLY_PAID') return 'warn';
  return 'danger';
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString();
}
