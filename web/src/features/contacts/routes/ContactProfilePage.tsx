import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ComingSoon } from '../../../shared/ui/ComingSoon';
import { ErrorMessage } from '../../../shared/ui/ErrorMessage';
import { Loading } from '../../../shared/ui/Loading';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { useContactTrades } from '../../trades/api/useTrades';
import {
  useArchiveContact,
  useContact,
  useUnarchiveContact,
  useUpdateContact,
  type Contact,
} from '../api/useContacts';
import { ContactForm } from '../components/ContactForm';

type Tab = 'overview' | 'receivables' | 'payables' | 'trades';

const TAB_ORDER: Tab[] = ['overview', 'receivables', 'payables', 'trades'];

// Explicit placeholder cards, not empty tables. An empty table reads as
// "no data yet", which is a bug signal; a card reading "arrives in
// Phase 4/5" tells the operator this is scope, not breakage
// (phase-2.md §5).
export function ContactProfilePage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const q = useContact(id);
  const update = useUpdateContact(id);
  const archive = useArchiveContact(id);
  const unarchive = useUnarchiveContact(id);
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');

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
        {tab === 'receivables' ? <ComingSoon /> : null}
        {tab === 'payables' ? <ComingSoon /> : null}
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
  const { t } = useTranslation();
  const q = useContactTrades(contactId);

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorMessage error={q.error} />;
  if (!q.data || q.data.data.length === 0) {
    return <p className="empty-state">{t('contacts.profile.trades_empty')}</p>;
  }

  return (
    <ul className="card-list" aria-label={t('contacts.profile.trades')}>
      {q.data.data.map((item) => {
        const path = item.kind === 'purchase' ? `/purchases/${item.id}` : `/sales/${item.id}`;
        const badge = item.kind === 'purchase' ? t('purchases.title') : t('sales.title');
        return (
          <li key={`${item.kind}-${item.id}`}>
            <Link to={path} className="card-row">
              <div className="card-row__header">
                <h3 className="card-row__title">
                  {item.deliveredAmount}{' '}
                  <span className="card-row__currency">{item.deliveredCurrencyId.slice(0, 3)}</span>
                </h3>
                <span className="badge badge--out">{badge}</span>
              </div>
              <div className="card-row__meta">
                <span className="card-row__mono">
                  {new Date(item.transactionDate).toLocaleDateString()}
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
