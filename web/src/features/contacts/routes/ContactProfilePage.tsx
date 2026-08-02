import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { ErrorMessage } from '../../../shared/ui/ErrorMessage';
import { Loading } from '../../../shared/ui/Loading';
import { PageHeader } from '../../../shared/ui/PageHeader';
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
        {tab === 'receivables' ? (
          <p className="placeholder-card">{t('contacts.profile.phase5_placeholder')}</p>
        ) : null}
        {tab === 'payables' ? (
          <p className="placeholder-card">{t('contacts.profile.phase5_placeholder')}</p>
        ) : null}
        {tab === 'trades' ? (
          <p className="placeholder-card">{t('contacts.profile.phase4_placeholder')}</p>
        ) : null}
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
