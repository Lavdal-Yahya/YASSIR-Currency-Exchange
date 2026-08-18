import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { SideBySideDebtsPanel } from '../../debts/components/SideBySideDebtsPanel';
import { ErrorMessage } from '../../../shared/ui/ErrorMessage';
import { Loading } from '../../../shared/ui/Loading';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { useBalances } from '../../openings/api/useOpenings';
import { useContactTrades } from '../../trades/api/useTrades';
import {
  useArchiveContact,
  useContact,
  useUnarchiveContact,
  useUpdateContact,
  type Contact,
} from '../api/useContacts';
import { ContactForm } from '../components/ContactForm';

type Tab = 'overview' | 'debts' | 'trades';

const TAB_ORDER: Tab[] = ['overview', 'debts', 'trades'];

const PAGE_STEP = 20;

export function ContactProfilePage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const q = useContact(id);
  const update = useUpdateContact(id);
  const archive = useArchiveContact(id);
  const unarchive = useUnarchiveContact(id);
  const [editing, setEditing] = useState(false);
  // Default to trades tab so clicking a contact shows their history immediately.
  const [tab, setTab] = useState<Tab>('trades');

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorMessage error={q.error} />;
  if (!q.data) return <p className="empty-state">{t('contacts.profile.not_found')}</p>;
  const c = q.data;

  if (editing) {
    return (
      <>
        <PageHeader title={t('contacts.edit')} />
        <ContactForm
          initial={c}
          onSubmit={async (input) => {
            await update.mutateAsync(input);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
          submitting={update.isPending}
          error={update.error}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={c.name}
        action={
          <button type="button" className="btn btn--secondary" onClick={() => setEditing(true)}>
            {t('common.edit')}
          </button>
        }
      />

      <nav className="tabs" role="tablist" aria-label={t('contacts.title')}>
        {TAB_ORDER.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            aria-current={tab === key ? 'page' : undefined}
            className="tabs__item"
            onClick={() => setTab(key)}
          >
            {t(`contacts.profile.${key}`)}
          </button>
        ))}
      </nav>

      <div role="tabpanel">
        {tab === 'overview' ? <OverviewPanel contact={c} /> : null}
        {tab === 'debts' ? <SideBySideDebtsPanel contactId={id} /> : null}
        {tab === 'trades' ? <ContactTradesTab contactId={id} /> : null}
      </div>

      <div className="profile-actions">
        {c.isArchived ? (
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => unarchive.mutate()}
            disabled={unarchive.isPending}
          >
            {t('contacts.unarchive')}
          </button>
        ) : (
          <button
            type="button"
            className="btn btn--danger"
            onClick={async () => {
              await archive.mutateAsync();
              navigate('/contacts');
            }}
            disabled={archive.isPending}
          >
            {t('contacts.archive')}
          </button>
        )}
      </div>
    </>
  );
}

function ContactTradesTab({ contactId }: { contactId: string }) {
  const { t, i18n } = useTranslation();
  const [limit, setLimit] = useState(PAGE_STEP);
  const q = useContactTrades(contactId, limit);
  // Build a UUID → currency code lookup from balances
  const balances = useBalances();
  const currencyCode = (id: string) =>
    balances.data?.find((b) => b.currencyId === id)?.code ?? id.slice(0, 3);

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorMessage error={q.error} />;
  if (!q.data || q.data.data.length === 0) {
    return <p className="empty-state">{t('contacts.profile.trades_empty')}</p>;
  }

  const dateFmt = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' });

  return (
    <>
      <ul className="card-list" aria-label={t('contacts.profile.trades')}>
        {q.data.data.map((item) => {
          const path = item.kind === 'purchase' ? `/purchases/${item.id}` : `/sales/${item.id}`;
          const isIn = item.kind === 'purchase';
          const badge = isIn ? t('purchases.title') : t('sales.title');
          return (
            <li key={`${item.kind}-${item.id}`}>
              <Link to={path} className="card-row">
                <div className="card-row__header">
                  <h3 className="card-row__title">
                    <span style={{ color: isIn ? 'var(--in-text)' : 'var(--out-text)' }}>
                      {isIn ? '↓' : '↑'}
                    </span>{' '}
                    {item.deliveredAmount}{' '}
                    <span className="card-row__currency">
                      {currencyCode(item.deliveredCurrencyId)}
                    </span>
                  </h3>
                  <span className={`badge ${isIn ? 'badge--in' : 'badge--out'}`}>{badge}</span>
                </div>
                <div className="card-row__meta">
                  <span className="card-row__mono">
                    {dateFmt.format(new Date(item.transactionDate))}
                  </span>
                  <span className={`badge badge--${payStatusClass(item.paymentStatus)}`}>
                    {item.kind === 'purchase'
                      ? t(`purchases.payment_status.${item.paymentStatus}`)
                      : t(`sales.payment_status.${item.paymentStatus}`)}
                  </span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>

      {q.data.total > limit ? (
        <div style={{ textAlign: 'center', marginBlockStart: 'var(--sp-4)' }}>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => setLimit((l) => l + PAGE_STEP)}
            disabled={q.isFetching}
          >
            {q.isFetching ? t('common.loading') : t('contacts.profile.see_more')}
          </button>
        </div>
      ) : null}
    </>
  );
}

function payStatusClass(status: string) {
  if (status === 'PAID') return 'in';
  if (status === 'PARTIALLY_PAID') return 'warn';
  return 'danger';
}

function OverviewPanel({ contact: c }: { contact: Contact }) {
  const { t } = useTranslation();
  return (
    <div className="card-row">
      <div className="card-row__meta">
        {c.phone ? <span className="card-row__mono">{c.phone}</span> : null}
        {c.isCustomer ? <span className="badge badge--in">{t('contacts.is_customer')}</span> : null}
        {c.isSupplier ? (
          <span className="badge badge--out">{t('contacts.is_supplier')}</span>
        ) : null}
        {c.isArchived ? (
          <span className="badge badge--danger">{t('contacts.archived_badge')}</span>
        ) : null}
      </div>
      {c.notes ? <p>{c.notes}</p> : null}
      <p className="card-row__mono">
        {t('contacts.profile.created_at')}: {new Date(c.createdAt).toLocaleString()}
      </p>
    </div>
  );
}
