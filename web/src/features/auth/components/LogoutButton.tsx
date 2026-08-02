import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useLogoutMutation } from '../api/useSession';

export function LogoutButton() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const logout = useLogoutMutation();

  async function onClick() {
    try {
      await logout.mutateAsync();
    } finally {
      // Whether or not the server call succeeded, the local cache is
      // cleared in onSettled and the safe thing is to leave the
      // authenticated area.
      navigate('/login', { replace: true });
    }
  }

  return (
    <button
      type="button"
      className="btn btn--danger"
      onClick={() => void onClick()}
      disabled={logout.isPending}
    >
      {logout.isPending ? t('common.loading') : t('auth.logout')}
    </button>
  );
}
