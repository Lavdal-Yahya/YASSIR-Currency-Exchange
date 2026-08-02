import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <>
      <h1 className="page-title">{t('notfound.title')}</h1>
      <p className="page-lede">{t('errors.unknown')}</p>
      <Link to="/">{t('notfound.back')}</Link>
    </>
  );
}
