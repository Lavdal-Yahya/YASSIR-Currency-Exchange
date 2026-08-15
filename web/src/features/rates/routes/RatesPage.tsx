import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { Loading } from '../../../shared/ui/Loading';
import { ErrorMessage } from '../../../shared/ui/ErrorMessage';
import { PERMISSIONS } from '../../../shared/permissions';
import { useSession } from '../../auth/api/useSession';
import { useCurrentRates, useRateHistory, useRefreshRates } from '../api/useRates';

// Rates page (P8-05). Current snapshot per non-base currency + history
// panel for a selected currency. Manual refresh button, owner-only.
// The list is informational (spec §21.2, D-007 superseded).

export function RatesPage() {
  const { t, i18n } = useTranslation();
  const dateFmt = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const session = useSession();
  const perms = new Set(session.data?.permissions ?? []);
  const canRefresh = perms.has(PERMISSIONS.RATE_MANAGE);
  const [selectedCurrencyId, setSelectedCurrencyId] = useState<string>('');
  const [flash, setFlash] = useState<string | null>(null);

  const current = useCurrentRates();
  const history = useRateHistory(selectedCurrencyId || undefined, 30);
  const refresh = useRefreshRates();

  async function onRefresh() {
    try {
      const result = await refresh.mutateAsync();
      setFlash(t('rates.refresh_result', { refreshed: result.refreshed, failed: result.failed }));
    } catch {
      setFlash(t('rates.refresh_failed'));
    }
  }

  return (
    <>
      <PageHeader
        title={t('rates.title')}
        action={
          canRefresh ? (
            <button
              type="button"
              className="btn btn--ghost"
              disabled={refresh.isPending}
              onClick={onRefresh}
            >
              {t('rates.refresh')}
            </button>
          ) : null
        }
      />

      {flash ? (
        <p className="banner banner--info" role="status">
          {flash}
        </p>
      ) : null}

      <h2>{t('rates.current')}</h2>
      {current.isLoading ? <Loading /> : null}
      {current.error ? <ErrorMessage error={current.error} /> : null}
      {current.data && current.data.length === 0 ? (
        <p className="empty-state">{t('rates.no_snapshot')}</p>
      ) : null}
      {current.data && current.data.length > 0 ? (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('rates.currency')}</th>
                <th>{t('rates.mid_rate')}</th>
                <th>{t('rates.source')}</th>
                <th>{t('rates.fetched_at')}</th>
                <th>{t('common.action')}</th>
              </tr>
            </thead>
            <tbody>
              {current.data.map((r) => (
                <tr key={r.currencyId}>
                  <td>{r.currencyCode}</td>
                  <td>{r.midRateMru} MRU</td>
                  <td>{r.source}</td>
                  <td>{dateFmt.format(new Date(r.fetchedAt))}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => setSelectedCurrencyId(r.currencyId)}
                    >
                      {t('rates.view_history')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {selectedCurrencyId ? (
        <>
          <h2>{t('rates.history')}</h2>
          {history.isLoading ? <Loading /> : null}
          {history.error ? <ErrorMessage error={history.error} /> : null}
          {history.data ? (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t('rates.fetched_at')}</th>
                    <th>{t('rates.mid_rate')}</th>
                    <th>{t('rates.source')}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {history.data.map((r) => (
                    <tr key={r.id}>
                      <td>{dateFmt.format(new Date(r.fetchedAt))}</td>
                      <td>{r.midRateMru} MRU</td>
                      <td>{r.source}</td>
                      <td>
                        {r.isCurrent ? (
                          <span className="badge badge--in">{t('rates.current_badge')}</span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      ) : null}
    </>
  );
}
