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
//
// The flex column is what makes "pushes content down" safe now that the
// shell pins a bar to the bottom of the viewport: the banner takes its
// height off the top and the shell gets the remainder, instead of the
// shell claiming a full 100dvh underneath it and shunting the tab bar
// off the bottom of the screen.

export function AppRoot() {
  const queryClient = useQueryClient();
  use401Redirect(queryClient);
  return (
    <div className="app-root">
      <OfflineBanner />
      <Outlet />
    </div>
  );
}
