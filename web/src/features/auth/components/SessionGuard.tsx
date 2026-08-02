import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation } from 'react-router-dom';
import { useSession } from '../api/useSession';

// Wraps routes that require a session. First-load renders a minimal
// spinner while `/auth/me` resolves; unauthenticated users bounce to
// /login with the original destination preserved so a successful login
// can send them back (a P2 concern — today's login always lands on /).

export function SessionGuard({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const session = useSession();
  const location = useLocation();

  if (session.isLoading) {
    return (
      <div className="app-shell__loading" role="status">
        {t('common.loading')}
      </div>
    );
  }

  if (!session.data) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
