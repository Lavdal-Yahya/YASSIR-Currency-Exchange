import { useTranslation } from 'react-i18next';
import { useSession } from '../../auth/api/useSession';
import { LogoutButton } from '../../auth/components/LogoutButton';
import { LanguageSwitcher } from '../../../shared/i18n/LanguageSwitcher';

export function MyProfilePage() {
  const { t } = useTranslation();
  const session = useSession();
  const user = session.data;

  return (
    <>
      {user && (
        <section className="profile-identity">
          <p className="profile-identity__name">{user.fullName}</p>
          <p className="profile-identity__phone">{user.phone}</p>
        </section>
      )}

      <section aria-labelledby="profile-lang">
        <h2 id="profile-lang" className="section-label">
          {t('profile.language')}
        </h2>
        <LanguageSwitcher />
      </section>

      <section className="profile-actions">
        <LogoutButton />
      </section>
    </>
  );
}
