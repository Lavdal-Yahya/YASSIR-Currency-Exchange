import { useTranslation } from 'react-i18next';

// Banner shown on the openings screens once settings.go_live_at is set.
// Explains why the forms are read-only or refused — matches D-023 item 7
// and P3-10.
export function GoLiveLockNotice() {
  const { t } = useTranslation();
  return (
    <div className="notice notice--warning" role="status">
      <strong>{t('openings.go_live_locked_title')}</strong>
      <p>{t('openings.go_live_locked_body')}</p>
    </div>
  );
}
