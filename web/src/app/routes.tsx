import type { RouteObject } from 'react-router-dom';
import { LoginPage } from '../features/auth/routes/LoginPage';
import { DashboardShell } from '../features/dashboard/routes/DashboardShell';
import { MyProfilePage } from '../features/profile/routes/MyProfilePage';
import { AppRoot } from './AppRoot';
import { AppShell } from './AppShell';
import { NotFoundPage } from './NotFoundPage';

// AppRoot wraps every route so the 401 redirect subscribes exactly once.
// Login sits directly under it (no bottom nav on the login screen); the
// authenticated pages sit under AppShell (bottom nav + safe-area).
// Session-guarding on AppShell lands in P1-14.
export const routes: RouteObject[] = [
  {
    element: <AppRoot />,
    children: [
      { path: '/login', element: <LoginPage /> },
      {
        element: <AppShell />,
        children: [
          { path: '/', element: <DashboardShell /> },
          { path: '/settings/profile', element: <MyProfilePage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
];
