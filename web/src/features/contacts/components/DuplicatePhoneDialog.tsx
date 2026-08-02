import { useTranslation } from 'react-i18next';

interface Props {
  existingName: string;
  onCancel: () => void;
  onConfirm: () => void;
  isConfirming?: boolean;
}

// Duplicate-phone confirmation. The API returns 409 with the existing
// row attached; the form catches the error, shows this dialog, and if
// the user chooses "create anyway" re-submits with confirmDuplicate=true.
// The `confirm` verb lives in the body, not the URL (phase-2.md §3).
export function DuplicatePhoneDialog({ existingName, onCancel, onConfirm, isConfirming }: Props) {
  const { t } = useTranslation();
  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="dupdlg-title">
      <div className="dialog">
        <h2 id="dupdlg-title" className="dialog__title">
          {t('contacts.duplicate_title')}
        </h2>
        <p>{t('contacts.duplicate_body', { name: existingName })}</p>
        <div className="dialog__actions">
          <button type="button" className="btn btn--ghost" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={onConfirm}
            disabled={isConfirming}
          >
            {t('contacts.duplicate_create_anyway')}
          </button>
        </div>
      </div>
    </div>
  );
}
