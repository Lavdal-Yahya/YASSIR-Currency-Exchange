import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCurrencies } from '../../currencies/api/useCurrencies';
import { ErrorMessage } from '../../../shared/ui/ErrorMessage';
import { Loading } from '../../../shared/ui/Loading';
import { useGoLive, useSettings, useUpdateSettings } from '../api/useSettings';

// Common IANA timezone options — tight list so the owner isn't offered
// hundreds of exotic zones. Adding one is a code edit, deliberate.
const TIMEZONE_OPTIONS = [
  'Africa/Nouakchott',
  'UTC',
  'Europe/Paris',
  'Africa/Casablanca',
  'Africa/Dakar',
];

export function SettingsBusinessPage() {
  const { t } = useTranslation();
  const settingsQ = useSettings();
  const currenciesQ = useCurrencies(false);
  const update = useUpdateSettings();
  const goLive = useGoLive();

  const [tz, setTz] = useState('');
  const [baseId, setBaseId] = useState('');
  const [neg, setNeg] = useState(false);
  const [confirmingGoLive, setConfirmingGoLive] = useState(false);

  useEffect(() => {
    if (settingsQ.data) {
      setTz(settingsQ.data.businessTimezone);
      setBaseId(settingsQ.data.baseCurrencyId);
      setNeg(settingsQ.data.negativeBalanceOverrideAllowed);
    }
  }, [settingsQ.data]);

  if (settingsQ.isLoading || currenciesQ.isLoading) return <Loading />;
  if (settingsQ.error) return <ErrorMessage error={settingsQ.error} />;
  if (!settingsQ.data) return null;
  const s = settingsQ.data;
  const goneLive = !!s.goLiveAt;

  async function save() {
    await update.mutateAsync({
      businessTimezone: tz,
      baseCurrencyId: baseId,
      negativeBalanceOverrideAllowed: neg,
    });
  }

  return (
    <>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="field">
          <label htmlFor="s-tz">{t('settings.business.timezone')}</label>
          <select id="s-tz" value={tz} onChange={(e) => setTz(e.target.value)}>
            {TIMEZONE_OPTIONS.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
          <p className="field__hint">{t('settings.business.timezone_hint')}</p>
        </div>

        <div className="field">
          <label htmlFor="s-base">{t('settings.business.base_currency')}</label>
          <select id="s-base" value={baseId} onChange={(e) => setBaseId(e.target.value)}>
            {(currenciesQ.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} — {c.name}
              </option>
            ))}
          </select>
          <p className="field__hint">{t('settings.business.base_currency_hint')}</p>
        </div>

        <label className="checkbox-row">
          <input type="checkbox" checked={neg} onChange={(e) => setNeg(e.target.checked)} />
          {t('settings.business.negative_balance_allow')}
        </label>

        {update.error ? <ErrorMessage error={update.error} /> : null}

        <div className="dialog__actions">
          <button type="submit" className="btn btn--primary" disabled={update.isPending}>
            {t('common.save')}
          </button>
        </div>
      </form>

      <section className="profile-actions">
        {goneLive ? (
          <p className="field__hint">
            {t('settings.business.go_live_locked', {
              date: s.goLiveAt ? new Date(s.goLiveAt).toLocaleDateString() : '',
            })}
          </p>
        ) : (
          <button
            type="button"
            className="btn btn--danger"
            onClick={() => setConfirmingGoLive(true)}
          >
            {t('settings.business.go_live')}
          </button>
        )}
      </section>

      {confirmingGoLive ? (
        <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="gl-title">
          <div className="dialog">
            <h2 id="gl-title" className="dialog__title">
              {t('settings.business.go_live_confirm_title')}
            </h2>
            <p>{t('settings.business.go_live_confirm_body')}</p>
            {goLive.error ? <ErrorMessage error={goLive.error} /> : null}
            <div className="dialog__actions">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setConfirmingGoLive(false)}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="btn btn--danger"
                onClick={async () => {
                  await goLive.mutateAsync();
                  setConfirmingGoLive(false);
                }}
                disabled={goLive.isPending}
              >
                {t('settings.business.go_live_confirm_action')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
