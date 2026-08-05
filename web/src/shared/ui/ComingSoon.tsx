import { useTranslation } from 'react-i18next';

export function ComingSoon() {
  const { t } = useTranslation();
  return (
    <div className="coming-soon" role="status" aria-label={t('common.coming_soon')}>
      <span className="coming-soon__label">{t('common.coming_soon')}</span>
    </div>
  );
}
