import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ErrorMessage } from '../../../shared/ui/ErrorMessage';
import { Loading } from '../../../shared/ui/Loading';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { useCurrencies } from '../api/useCurrencies';

export function CurrenciesListPage() {
  const { t } = useTranslation();
  const [includeInactive, setIncludeInactive] = useState(false);
  const q = useCurrencies(includeInactive);

  return (
    <>
      <PageHeader
        title={t('currencies.title')}
        action={
          <Link to="/currencies/new" className="btn btn--primary">
            {t('currencies.new')}
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
          {t('currencies.include_inactive')}
        </label>
      </div>
      {q.isLoading ? <Loading /> : null}
      {q.error ? <ErrorMessage error={q.error} /> : null}
      {q.data && q.data.length === 0 ? (
        <p className="empty-state">{t('currencies.empty')}</p>
      ) : null}
      {q.data && q.data.length > 0 ? (
        <ul className="card-list" aria-label={t('currencies.title')}>
          {q.data.map((c) => (
            <li key={c.id}>
              <Link to={`/currencies/${c.id}/edit`} className="card-row">
                <div className="card-row__header">
                  <h2 className="card-row__title">{c.code}</h2>
                  {c.isActive ? (
                    <span className="badge badge--in">{t('common.active')}</span>
                  ) : (
                    <span className="badge">{t('common.inactive')}</span>
                  )}
                </div>
                <div className="card-row__meta">
                  <span>{c.name}</span>
                  <span className="card-row__mono">dp={c.decimalPlaces}</span>
                  {c.lowBalanceThreshold ? (
                    <span className="card-row__mono">
                      {t('currencies.low_threshold_label')}: {c.lowBalanceThreshold}
                    </span>
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
