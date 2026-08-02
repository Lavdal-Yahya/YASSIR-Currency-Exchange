import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ErrorMessage } from '../../../shared/ui/ErrorMessage';
import { Loading } from '../../../shared/ui/Loading';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { useUsers } from '../api/useUsers';

export function UsersListPage() {
  const { t } = useTranslation();
  const [includeInactive, setIncludeInactive] = useState(false);
  const q = useUsers(includeInactive);

  return (
    <>
      <PageHeader
        title={t('users.title')}
        action={
          <Link to="/users/new" className="btn btn--primary">
            {t('users.new')}
          </Link>
        }
      />
      <div className="toolbar">
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.target.checked)}
          />
          {t('users.include_inactive')}
        </label>
      </div>
      {q.isLoading ? <Loading /> : null}
      {q.error ? <ErrorMessage error={q.error} /> : null}
      {q.data && q.data.length === 0 ? <p className="empty-state">{t('users.empty')}</p> : null}
      {q.data && q.data.length > 0 ? (
        <ul className="card-list" aria-label={t('users.title')}>
          {q.data.map((u) => (
            <li key={u.id}>
              <Link to={`/users/${u.id}/edit`} className="card-row">
                <div className="card-row__header">
                  <h2 className="card-row__title">{u.fullName}</h2>
                  {u.isActive ? (
                    <span className="badge badge--in">{t('common.active')}</span>
                  ) : (
                    <span className="badge">{t('common.inactive')}</span>
                  )}
                </div>
                <div className="card-row__meta">
                  <span className="card-row__mono">{u.phone}</span>
                  {u.roles.map((r) => (
                    <span key={r} className="badge">
                      {r === 'OWNER'
                        ? t('users.role_owner')
                        : r === 'EMPLOYEE'
                          ? t('users.role_employee')
                          : r}
                    </span>
                  ))}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
