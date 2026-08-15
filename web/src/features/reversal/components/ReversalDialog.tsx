import { useState } from 'react';
import { useTranslation } from 'react-i18next';

// ReversalDialog — modal used from every detail page. Mandatory reason;
// the submit button is disabled while empty. For trade reversals, the
// caller passes `warnMessage` so the operator sees the recompute-and-
// restate consequence (D-021) *before* confirming (phase-6.md §5).
//
// After the mutation resolves, the caller decides what to do with the
// response — for trade reversals, they typically show a toast with the
// count of restated sales.

export interface ReversalDialogProps {
  open: boolean;
  title: string;
  warnMessage?: string;
  isSubmitting: boolean;
  errorMessage?: string;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}

export function ReversalDialog({
  open,
  title,
  warnMessage,
  isSubmitting,
  errorMessage,
  onCancel,
  onConfirm,
}: ReversalDialogProps) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  if (!open) return null;
  const trimmed = reason.trim();
  return (
    // Uses the shared dialog vocabulary (.dialog-backdrop / .dialog / …)
    // rather than a parallel modal-* set. The modal-* names had no CSS at
    // all, so this dialog rendered inline in the page flow with no overlay
    // — on the one action in the app that most needs a deliberate stop.
    <div
      className="dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reversal-title"
    >
      <div className="dialog">
        <h2 id="reversal-title" className="dialog__title">
          {title}
        </h2>
        {warnMessage ? (
          <p className="notice notice--warn" role="note">
            {warnMessage}
          </p>
        ) : null}
        <label className="field">
          <span>{t('reversal.reason_label')}</span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            required
            disabled={isSubmitting}
            aria-required="true"
          />
        </label>
        {errorMessage ? (
          <p className="field__error" role="alert">
            {errorMessage}
          </p>
        ) : null}
        <div className="dialog__actions">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn btn--danger"
            onClick={() => onConfirm(trimmed)}
            disabled={isSubmitting || trimmed === ''}
          >
            {t('reversal.confirm_button')}
          </button>
        </div>
      </div>
    </div>
  );
}
