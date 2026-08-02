import type { RouteObject } from 'react-router-dom';
import { LoginPage } from '../features/auth/routes/LoginPage';
import { DashboardShell } from '../features/dashboard/routes/DashboardShell';
import { MyProfilePage } from '../features/profile/routes/MyProfilePage';
import { AppShell } from './AppShell';
import { NotFoundPage } from './NotFoundPage';

// Login lives outside the AppShell — no bottom nav on the login screen.
// Session-guarding lands in P1-14; today every route resolves openly.
export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  {
    element: <AppShell />,
    children: [
      { path: '/', element: <DashboardShell /> },
      { path: '/settings/profile', element: <MyProfilePage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
