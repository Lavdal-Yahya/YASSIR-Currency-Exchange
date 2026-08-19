import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MorePage } from './MorePage';
import { PERMISSIONS } from '../../../shared/permissions';

// Before the More menu existed, /expenses, /currencies, /users and
// /payments had no inbound link anywhere in the app — the only
// references to them were the post-submit redirects on their own forms,
// so they were reachable only by typing the URL. These tests are the
// regression guard on that.

const OWNER = {
  id: 'u-1',
  phone: '+22200000000',
  fullName: 'Amina Sow',
  roles: ['OWNER'],
  permissions: Object.values(PERMISSIONS),
};

function stubSession(user: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify(user), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    ),
  );
}

beforeEach(() => stubSession(OWNER));

function renderMore() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <MorePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function hrefs() {
  return screen.getAllByRole('link').map((a) => a.getAttribute('href'));
}

describe('MorePage', () => {
  it('links the four screens that previously had no inbound link', async () => {
    renderMore();
    await screen.findByRole('link', { name: /Dépenses/ });
    for (const path of ['/expenses', '/currencies', '/users', '/payments']) {
      expect(hrefs()).toContain(path);
    }
  });

  it('links every remaining non-tab destination', async () => {
    renderMore();
    await screen.findByRole('link', { name: /Dépenses/ });
    for (const path of [
      '/contacts',
      '/balances',
      '/openings',
      '/rates',
      '/reports/profit',
      '/reports/cash-flow',
      '/reports/ageing',
      '/reports/user-activity',
      '/audit',
      '/settings',
    ]) {
      expect(hrefs()).toContain(path);
    }
  });

  it('omits entries the session has no permission for', async () => {
    stubSession({ ...OWNER, roles: ['EMPLOYEE'], permissions: [PERMISSIONS.EXPENSE_READ] });
    renderMore();
    await screen.findByRole('link', { name: /Dépenses/ });
    expect(hrefs()).toEqual(['/expenses']);
  });

  it('renders no empty group heading when every entry in it is filtered out', async () => {
    stubSession({ ...OWNER, roles: ['EMPLOYEE'], permissions: [PERMISSIONS.EXPENSE_READ] });
    renderMore();
    await screen.findByRole('link', { name: /Dépenses/ });
    // "Argent" holds the one visible entry; no other group should appear.
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Argent',
    ]);
  });
});
