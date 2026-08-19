import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { PageHeader } from '../shared/ui/PageHeader';

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t('notfound.title')} />
      <p className="page-lede">{t('errors.unknown')}</p>
      <Link to="/">{t('notfound.back')}</Link>
    </>
  );
}
