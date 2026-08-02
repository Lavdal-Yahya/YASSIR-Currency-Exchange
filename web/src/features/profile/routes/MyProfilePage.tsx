import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from '../../../shared/i18n/LanguageSwitcher';

// Name and logout arrive with P1-14 (session guard). Today the profile
// page exists so the language switcher has a natural home.

export function MyProfilePage() {
  const { t } = useTranslation();
  return (
    <>
      <h1 className="page-title">{t('profile.title')}</h1>
      <section aria-labelledby="profile-lang">
        <h2 id="profile-lang" className="section-label">
          {t('profile.language')}
        </h2>
        <LanguageSwitcher />
      </section>
    </>
  );
}
