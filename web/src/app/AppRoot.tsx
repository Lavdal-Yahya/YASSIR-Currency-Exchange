import { useQueryClient } from '@tanstack/react-query';
import { Outlet } from 'react-router-dom';
import { OfflineBanner } from '../shared/pwa/OfflineBanner';
import { use401Redirect } from '../shared/session/session';

// Root layout element for the router — mounts once, inside both the
// QueryClientProvider (from App) and the RouterProvider. Wires the
// global 401 → /login redirect here because it needs both the query
// client (to clear the auth cache) and the router (to navigate).
// The offline banner sits above every route so it pushes content down
// consistently on both the login screen and the authenticated shell.

export function AppRoot() {
  const queryClient = useQueryClient();
  use401Redirect(queryClient);
  return (
    <>
      <OfflineBanner />
      <Outlet />
    </>
  );
}
