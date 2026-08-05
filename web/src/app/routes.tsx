import type { RouteObject } from 'react-router-dom';
import { SessionGuard } from '../features/auth/components/SessionGuard';
import { LoginPage } from '../features/auth/routes/LoginPage';
import { ContactProfilePage } from '../features/contacts/routes/ContactProfilePage';
import { ContactsListPage } from '../features/contacts/routes/ContactsListPage';
import { CurrenciesListPage } from '../features/currencies/routes/CurrenciesListPage';
import { CurrencyFormPage } from '../features/currencies/routes/CurrencyFormPage';
import { DashboardShell } from '../features/dashboard/routes/DashboardShell';
import { BalancesDashboardPage } from '../features/openings/routes/BalancesDashboardPage';
import { OpeningCurrencyFormPage } from '../features/openings/routes/OpeningCurrencyFormPage';
import { OpeningDebtFormPage } from '../features/openings/routes/OpeningDebtFormPage';
import { OpeningsHomePage } from '../features/openings/routes/OpeningsHomePage';
import { MyProfilePage } from '../features/profile/routes/MyProfilePage';
import { SettingsBusinessPage } from '../features/settings/routes/SettingsBusinessPage';
import { SettingsExpenseCategoriesPage } from '../features/settings/routes/SettingsExpenseCategoriesPage';
import { SettingsLayout } from '../features/settings/routes/SettingsLayout';
import { SettingsPaymentMethodsPage } from '../features/settings/routes/SettingsPaymentMethodsPage';
import { SettingsPermissionsPage } from '../features/settings/routes/SettingsPermissionsPage';
import { PurchaseDetailPage } from '../features/trades/routes/PurchaseDetailPage';
import { PurchaseFormPage } from '../features/trades/routes/PurchaseFormPage';
import { PurchasesListPage } from '../features/trades/routes/PurchasesListPage';
import { SaleDetailPage } from '../features/trades/routes/SaleDetailPage';
import { SaleFormPage } from '../features/trades/routes/SaleFormPage';
import { SalesListPage } from '../features/trades/routes/SalesListPage';
import { UserFormPage } from '../features/users/routes/UserFormPage';
import { UsersListPage } from '../features/users/routes/UsersListPage';
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

          { path: '/purchases', element: <PurchasesListPage /> },
          { path: '/purchases/new', element: <PurchaseFormPage /> },
          { path: '/purchases/:id', element: <PurchaseDetailPage /> },

          { path: '/sales', element: <SalesListPage /> },
          { path: '/sales/new', element: <SaleFormPage /> },
          { path: '/sales/:id', element: <SaleDetailPage /> },

          { path: '/contacts', element: <ContactsListPage /> },
          { path: '/contacts/:id', element: <ContactProfilePage /> },

          { path: '/currencies', element: <CurrenciesListPage /> },
          { path: '/currencies/new', element: <CurrencyFormPage /> },
          { path: '/currencies/:id/edit', element: <CurrencyFormPage /> },

          { path: '/balances', element: <BalancesDashboardPage /> },
          { path: '/openings', element: <OpeningsHomePage /> },
          { path: '/openings/currency/new', element: <OpeningCurrencyFormPage /> },
          { path: '/openings/debt/new', element: <OpeningDebtFormPage /> },

          { path: '/users', element: <UsersListPage /> },
          { path: '/users/new', element: <UserFormPage /> },
          { path: '/users/:id/edit', element: <UserFormPage /> },

          {
            path: '/settings',
            element: <SettingsLayout />,
            children: [
              { index: true, element: <SettingsBusinessPage /> },
              { path: 'business', element: <SettingsBusinessPage /> },
              { path: 'profile', element: <MyProfilePage /> },
              { path: 'payment-methods', element: <SettingsPaymentMethodsPage /> },
              { path: 'expense-categories', element: <SettingsExpenseCategoriesPage /> },
              { path: 'permissions', element: <SettingsPermissionsPage /> },
            ],
          },

          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
];
