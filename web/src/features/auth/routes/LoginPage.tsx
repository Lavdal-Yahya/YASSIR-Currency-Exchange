import { useTranslation } from 'react-i18next';

// Placeholder — the real form arrives with P1-14 (phone + PIN, submit
// disabled on click, argon2 handled server-side).

export function LoginPage() {
  const { t } = useTranslation();
  return (
    <main className="app-shell__main">
      <h1 className="page-title">{t('login.title')}</h1>
      <p className="page-lede">{t('login.welcome')}</p>
    </main>
  );
}
