import { useTranslation } from 'react-i18next';

export function Loading() {
  const { t } = useTranslation();
  return <p className="empty-state">{t('common.loading')}</p>;
}
