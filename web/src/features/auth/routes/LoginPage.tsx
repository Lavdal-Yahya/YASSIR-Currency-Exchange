import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { LanguageSwitcher } from '../../../shared/i18n/LanguageSwitcher';
import { useSession } from '../api/useSession';
import { LoginForm } from '../components/LoginForm';

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const session = useSession();

  // Bounce out if the user lands on /login already authenticated (e.g.
  // hits back after logging in). Runs whenever the session query settles.
  useEffect(() => {
    if (session.data) {
      navigate('/', { replace: true });
    }
  }, [session.data, navigate]);

  return (
    <main className="login-page">
      <div className="login-page__frame">
        {/* The switcher is on the login screen deliberately: a user who
            cannot read the interface cannot sign in to change it. */}
        <div className="login-page__lang">
          <LanguageSwitcher />
        </div>
        <h1 className="page-title">{t('login.title')}</h1>
        <p className="page-lede">{t('login.welcome')}</p>
        <LoginForm onSuccess={() => navigate('/', { replace: true })} />
      </div>
    </main>
  );
}
