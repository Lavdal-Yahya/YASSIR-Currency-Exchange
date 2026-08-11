import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useContacts } from '../../contacts/api/useContacts';
import { useCurrencies } from '../../currencies/api/useCurrencies';
import { ErrorMessage } from '../../../shared/ui/ErrorMessage';
import { Loading } from '../../../shared/ui/Loading';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { usePurchases } from '../api/useTrades';

const LIMIT = 25;

const EMPTY: Record<string, string> = {
  status: '',
  paymentStatus: '',
  currencyId: '',
  contactId: '',
  dateFrom: '',
  dateTo: '',
};

export function PurchasesListPage() {
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

  const q = usePurchases(query);

  const hasFilters = Object.values(f).some(Boolean);
  const totalPages = q.data ? Math.ceil(q.data.total / LIMIT) : 1;

  return (
    <>
      <PageHeader
        title={t('purchases.title')}
        action={
          <Link to="/purchases/new" className="btn btn--primary">
            {t('purchases.new')}
          </Link>
        }
      />

      <div className="toolbar">
        <select value={f.status} onChange={(e) => setField('status', e.target.value)}>
          <option value="">{t('common.filter.all_statuses')}</option>
          <option value="CONFIRMED">{t('purchases.status.CONFIRMED')}</option>
          <option value="CANCELLED">{t('purchases.status.CANCELLED')}</option>
          <option value="REVERSED">{t('purchases.status.REVERSED')}</option>
        </select>

        <select value={f.paymentStatus} onChange={(e) => setField('paymentStatus', e.target.value)}>
          <option value="">{t('common.filter.all_payment_statuses')}</option>
          <option value="UNPAID">{t('purchases.payment_status.UNPAID')}</option>
          <option value="PARTIALLY_PAID">{t('purchases.payment_status.PARTIALLY_PAID')}</option>
          <option value="PAID">{t('purchases.payment_status.PAID')}</option>
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
        <p className="empty-state">{t('purchases.empty')}</p>
      ) : null}
      {q.data && q.data.data.length > 0 ? (
        <ul className="card-list" aria-label={t('purchases.title')}>
          {q.data.data.map((p) => (
            <li key={p.id}>
              <Link to={`/purchases/${p.id}`} className="card-row">
                <div className="card-row__header">
                  <h2 className="card-row__title">
                    {p.deliveredAmount}{' '}
                    <span className="card-row__currency">
                      {currencies.data?.find((c) => c.id === p.deliveredCurrencyId)?.code ??
                        p.deliveredCurrencyId.slice(0, 3)}
                    </span>
                  </h2>
                  <span className={`badge badge--${paymentStatusClass(p.paymentStatus)}`}>
                    {t(`purchases.payment_status.${p.paymentStatus}`)}
                  </span>
                </div>
                <div className="card-row__meta">
                  <span className="card-row__mono">{formatDate(p.transactionDate)}</span>
                  <span>{p.paymentTotal} ←</span>
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
