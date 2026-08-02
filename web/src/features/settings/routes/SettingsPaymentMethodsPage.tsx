import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorMessage } from '../../../shared/ui/ErrorMessage';
import { Loading } from '../../../shared/ui/Loading';
import {
  useCreatePaymentMethod,
  useDeactivatePaymentMethod,
  usePaymentMethods,
  useReactivatePaymentMethod,
  type PaymentMethod,
} from '../../payment-methods/api/usePaymentMethods';

// CASH cannot be deactivated (server refuses with 422). OTHER always
// requires a note (rendered read-only). Both rules from D-020.

export function SettingsPaymentMethodsPage() {
  const { t } = useTranslation();
  const q = usePaymentMethods(true);
  const create = useCreatePaymentMethod();
  const [showAdd, setShowAdd] = useState(false);

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorMessage error={q.error} />;

  return (
    <>
      <div className="dialog__actions">
        <button type="button" className="btn btn--primary" onClick={() => setShowAdd(true)}>
          {t('settings.payment_methods.add')}
        </button>
      </div>

      <ul className="card-list" aria-label={t('settings.payment_methods.title')}>
        {(q.data ?? []).map((m) => (
          <li key={m.id}>
            <PaymentMethodRow method={m} />
          </li>
        ))}
      </ul>

      {showAdd ? (
        <AddDialog
          onCancel={() => setShowAdd(false)}
          onCreate={async (input) => {
            await create.mutateAsync(input);
            setShowAdd(false);
          }}
          error={create.error}
          submitting={create.isPending}
        />
      ) : null}
    </>
  );
}

function PaymentMethodRow({ method: m }: { method: PaymentMethod }) {
  const { t } = useTranslation();
  const deactivate = useDeactivatePaymentMethod(m.id);
  const reactivate = useReactivatePaymentMethod(m.id);
  const isCash = m.code === 'CASH';
  const isOther = m.code === 'OTHER';

  return (
    <div className="card-row">
      <div className="card-row__header">
        <h3 className="card-row__title">
          {m.labelFr} · <span className="card-row__mono">{m.code}</span>
        </h3>
        {m.isActive ? (
          <span className="badge badge--in">{t('common.active')}</span>
        ) : (
          <span className="badge">{t('common.inactive')}</span>
        )}
      </div>
      <div className="card-row__meta">
        {m.requiresNote ? (
          <span className="badge badge--out">{t('settings.payment_methods.requires_note')}</span>
        ) : null}
      </div>
      {isOther ? (
        <p className="field__hint">{t('settings.payment_methods.requires_note_locked')}</p>
      ) : null}
      {(deactivate.error ?? reactivate.error) ? (
        <ErrorMessage error={deactivate.error ?? reactivate.error} />
      ) : null}
      <div className="dialog__actions">
        {isCash ? (
          <p className="field__hint">{t('settings.payment_methods.cash_locked')}</p>
        ) : m.isActive ? (
          <button
            type="button"
            className="btn btn--danger"
            onClick={() => deactivate.mutate()}
            disabled={deactivate.isPending}
          >
            {t('settings.payment_methods.deactivate')}
          </button>
        ) : (
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => reactivate.mutate()}
            disabled={reactivate.isPending}
          >
            {t('settings.payment_methods.reactivate')}
          </button>
        )}
      </div>
    </div>
  );
}

function AddDialog(props: {
  onCancel: () => void;
  onCreate: (input: { code: string; labelFr: string; labelAr: string }) => Promise<void>;
  error: unknown;
  submitting: boolean;
}) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [labelFr, setLabelFr] = useState('');
  const [labelAr, setLabelAr] = useState('');

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="pm-title">
      <div className="dialog">
        <h2 id="pm-title" className="dialog__title">
          {t('settings.payment_methods.add')}
        </h2>
        <div className="field">
          <label htmlFor="pm-code">{t('settings.payment_methods.code')}</label>
          <input
            id="pm-code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            autoCapitalize="characters"
          />
        </div>
        <div className="field">
          <label htmlFor="pm-fr">{t('settings.payment_methods.label_fr')}</label>
          <input id="pm-fr" value={labelFr} onChange={(e) => setLabelFr(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="pm-ar">{t('settings.payment_methods.label_ar')}</label>
          <input id="pm-ar" value={labelAr} onChange={(e) => setLabelAr(e.target.value)} />
        </div>
        {props.error ? <ErrorMessage error={props.error} /> : null}
        <div className="dialog__actions">
          <button type="button" className="btn btn--ghost" onClick={props.onCancel}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => props.onCreate({ code, labelFr, labelAr })}
            disabled={!code || !labelFr || !labelAr || props.submitting}
          >
            {t('common.create')}
          </button>
        </div>
      </div>
    </div>
  );
}
