import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useContacts } from '../../contacts/api/useContacts';
import { useCurrencies } from '../../currencies/api/useCurrencies';
import { ErrorMessage } from '../../../shared/ui/ErrorMessage';
import { Loading } from '../../../shared/ui/Loading';
import { AgeBucketFilter } from '../components/AgeBucketFilter';
import { useReceivables, type AgeBucket } from '../api/useDebts';

const LIMIT = 25;

interface Filters {
  contactId: string;
  currencyId: string;
  ageBucket: AgeBucket | '';
}

const EMPTY: Filters = { contactId: '', currencyId: '', ageBucket: '' };

// Only status=OPEN rows carry outstanding debt. paymentStatus PAID is
// filtered client-side because the API accepts a single value and we
// want both UNPAID and PARTIALLY_PAID visible together.
export function ReceivablesListPage() {
  const { t } = useTranslation();
  const [f, setF] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(0);

  const contacts = useContacts();
  const currencies = useCurrencies();

  function setField<K extends keyof Filters>(key: K, value: Filters[K]) {
    setPage(0);
    setF((prev) => ({ ...prev, [key]: value }));
  }

  const q = useReceivables({
    ...(f.contactId ? { contactId: f.contactId } : {}),
    ...(f.currencyId ? { currencyId: f.currencyId } : {}),
    ...(f.ageBucket ? { ageBucket: f.ageBucket } : {}),
    status: 'OPEN',
    limit: LIMIT,
    offset: page * LIMIT,
  });

  const rows = q.data?.data.filter((r) => r.paymentStatus !== 'PAID') ?? [];
  const hasFilters = !!(f.contactId || f.currencyId || f.ageBucket);
  const totalPages = q.data ? Math.max(1, Math.ceil(q.data.total / LIMIT)) : 1;

  return (
    <>
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

      <AgeBucketFilter value={f.ageBucket} onChange={(next) => setField('ageBucket', next)} />

      {q.isLoading ? <Loading /> : null}
      {q.error ? <ErrorMessage error={q.error} /> : null}
      {q.data && rows.length === 0 ? (
        <p className="empty-state">{t('debts.receivables_empty')}</p>
      ) : null}
      {rows.length > 0 ? (
        <ul className="card-list" aria-label={t('debts.tab_receivables')}>
          {rows.map((r) => {
            const contactName =
              contacts.data?.find((c) => c.id === r.contactId)?.name ?? r.contactId.slice(0, 8);
            const currCode =
              currencies.data?.find((c) => c.id === r.currencyId)?.code ?? r.currencyId.slice(0, 3);
            return (
              <li key={r.id}>
                <Link to={`/debts/receivables/${r.id}/receive`} className="card-row">
                  <div className="card-row__header">
                    <h3 className="card-row__title">
                      {r.outstandingAmount} <span className="card-row__currency">{currCode}</span>
                    </h3>
                    <span className="badge badge--in">{t('debts.receive_action')}</span>
                  </div>
                  <div className="card-row__meta">
                    <span>{contactName}</span>
                    <span className="card-row__mono">{ageLabel(r.createdAt, t)}</span>
                    <span className={`badge badge--${payStatusClass(r.paymentStatus)}`}>
                      {t(`debts.payment_status.${r.paymentStatus}`)}
                    </span>
                  </div>
                </Link>
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

function ageLabel(iso: string, t: (k: string, o?: Record<string, unknown>) => string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return t('debts.age_days', { n: days });
}

function payStatusClass(status: string) {
  if (status === 'PAID') return 'in';
  if (status === 'PARTIALLY_PAID') return 'warn';
  return 'danger';
}
