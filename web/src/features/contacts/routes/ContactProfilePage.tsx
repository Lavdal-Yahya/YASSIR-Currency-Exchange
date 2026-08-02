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
} from '../api/useContacts';
import { ContactForm } from '../components/ContactForm';

// P2-09 iteration: overview + edit + archive/unarchive.
// P2-10 adds the placeholder tabs (receivables / payables / trades).
export function ContactProfilePage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const q = useContact(id);
  const update = useUpdateContact(id);
  const archive = useArchiveContact(id);
  const unarchive = useUnarchiveContact(id);
  const [editing, setEditing] = useState(false);

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
      <div className="card-row">
        <div className="card-row__meta">
          {c.phone ? <span className="card-row__mono">{c.phone}</span> : null}
          {c.isCustomer ? (
            <span className="badge badge--in">{t('contacts.is_customer')}</span>
          ) : null}
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
