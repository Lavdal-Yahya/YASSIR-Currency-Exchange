import type { RouteObject } from 'react-router-dom';
import { SessionGuard } from '../features/auth/components/SessionGuard';
import { LoginPage } from '../features/auth/routes/LoginPage';
import { DashboardShell } from '../features/dashboard/routes/DashboardShell';
import { MyProfilePage } from '../features/profile/routes/MyProfilePage';
import { AppRoot } from './AppRoot';
import { AppShell } from './AppShell';
import { NotFoundPage } from './NotFoundPage';

// AppRoot wraps every route so the 401 redirect subscribes exactly once.
// Login sits directly under it (no bottom nav on the login screen). The
// SessionGuard sits between AppRoot and AppShell so the whole
// authenticated area — including the 404 page — requires a session.
export const routes: RouteObject[] = [
  {
    element: <AppRoot />,
    children: [
      { path: '/login', element: <LoginPage /> },
      {
        element: (
          <SessionGuard>
            <AppShell />
          </SessionGuard>
        ),
        children: [
          { path: '/', element: <DashboardShell /> },
          { path: '/settings/profile', element: <MyProfilePage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
];
