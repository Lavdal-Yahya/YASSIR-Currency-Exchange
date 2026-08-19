import { useMemo } from 'react';
import { useSession } from '../../features/auth/api/useSession';
import type { PermissionCode } from '../permissions';

/**
 * The permission set for the current session, as a `Set` with a typed
 * `has`. Formalises the `new Set(session.data?.permissions ?? [])`
 * pattern that DashboardShell and RatesPage were each rolling by hand.
 *
 * This is a *courtesy* check only — it hides controls the user cannot
 * use. The API guard is the enforcement point (architecture §4), and a
 * user who types the URL still gets a 403 from the server. Never treat
 * a `true` here as authorisation.
 */
export function usePermissions(): { has: (code: PermissionCode) => boolean; isLoading: boolean } {
  const session = useSession();
  const codes = session.data?.permissions;

  return useMemo(() => {
    const set = new Set(codes ?? []);
    return {
      has: (code: PermissionCode) => set.has(code),
      isLoading: session.isLoading,
    };
  }, [codes, session.isLoading]);
}
