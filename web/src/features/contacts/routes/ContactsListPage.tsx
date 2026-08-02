import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { ErrorMessage } from '../../../shared/ui/ErrorMessage';
import { Loading } from '../../../shared/ui/Loading';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { ContactForm } from '../components/ContactForm';
import { useContacts, useCreateContact, type ContactFilters } from '../api/useContacts';

type Kind = 'all' | 'customer' | 'supplier';

export function ContactsListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<Kind>('all');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [creating, setCreating] = useState(false);

  const filters: ContactFilters = { search, includeArchived };
  if (kind === 'customer') filters.isCustomer = true;
  if (kind === 'supplier') filters.isSupplier = true;

  const q = useContacts(filters);
  const create = useCreateContact();

  if (creating) {
    return (
      <>
        <PageHeader title={t('contacts.new')} />
        <ContactForm
          onSubmit={async (input) => {
            const created = await create.mutateAsync(input);
            setCreating(false);
            navigate(`/contacts/${created.id}`);
          }}
          onCancel={() => setCreating(false)}
          submitting={create.isPending}
          error={create.error}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={t('contacts.title')}
        action={
          <button type="button" className="btn btn--primary" onClick={() => setCreating(true)}>
            {t('contacts.new')}
          </button>
        }
      />
      <div className="toolbar">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('contacts.search_placeholder')}
          aria-label={t('common.search')}
        />
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as Kind)}
          aria-label={t('contacts.title')}
        >
          <option value="all">{t('contacts.all_types')}</option>
          <option value="customer">{t('contacts.customers_only')}</option>
          <option value="supplier">{t('contacts.suppliers_only')}</option>
        </select>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
          />
          {t('contacts.include_archived')}
        </label>
      </div>
      {q.isLoading ? <Loading /> : null}
      {q.error ? <ErrorMessage error={q.error} /> : null}
      {q.data && q.data.length === 0 ? <p className="empty-state">{t('contacts.empty')}</p> : null}
      {q.data && q.data.length > 0 ? (
        <ul className="card-list" aria-label={t('contacts.title')}>
          {q.data.map((c) => (
            <li key={c.id}>
              <Link to={`/contacts/${c.id}`} className="card-row">
                <div className="card-row__header">
                  <h2 className="card-row__title">{c.name}</h2>
                  {c.isArchived ? (
                    <span className="badge badge--danger">{t('contacts.archived_badge')}</span>
                  ) : null}
                </div>
                <div className="card-row__meta">
                  {c.phone ? <span className="card-row__mono">{c.phone}</span> : null}
                  {c.isCustomer ? (
                    <span className="badge badge--in">{t('contacts.is_customer')}</span>
                  ) : null}
                  {c.isSupplier ? (
                    <span className="badge badge--out">{t('contacts.is_supplier')}</span>
                  ) : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
