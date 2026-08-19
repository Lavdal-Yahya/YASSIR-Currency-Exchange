import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from './AppShell';
import { PERMISSIONS } from '../shared/permissions';

// The shell after the navigation rebuild: bottom tab bar (four
// destinations plus the FAB), title bar, and the action sheet.
//
// The permission assertions are the point of most of these — the old
// nav rendered a fixed six items to everyone, so an employee was shown
// tabs that answer with 403.

const OWNER = {
  id: 'u-1',
  phone: '+22200000000',
  fullName: 'Amina Sow',
  roles: ['OWNER'],
  permissions: Object.values(PERMISSIONS),
};

function session(user: unknown) {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(user), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', session(OWNER));
});

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<div>dashboard-content</div>} />
            <Route path="/operations" element={<div>operations-content</div>} />
            <Route path="/debts/*" element={<div>debts-content</div>} />
            <Route path="/more" element={<div>more-content</div>} />
            <Route path="/purchases/:id" element={<div>purchase-detail</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function tabBar() {
  return screen.getByRole('navigation', { name: /Navigation principale/ });
}

describe('AppShell bottom nav', () => {
  it('renders four destinations and the action FAB — five slots, not six', async () => {
    renderAt('/');
    const bar = tabBar();
    expect(await within(bar).findByRole('link', { name: /Opérations/ })).toBeTruthy();
    expect(within(bar).getByRole('link', { name: /Tableau/ })).toBeTruthy();
    expect(within(bar).getByRole('link', { name: /Dettes/ })).toBeTruthy();
    expect(within(bar).getByRole('link', { name: /Plus/ })).toBeTruthy();
    expect(within(bar).getAllByRole('link')).toHaveLength(4);
    expect(within(bar).getByRole('button', { name: /Actions rapides/ })).toBeTruthy();
  });

  it('marks the dashboard tab current on /', async () => {
    renderAt('/');
    const dashboard = await within(tabBar()).findByRole('link', { name: /Tableau/ });
    expect(dashboard.getAttribute('aria-current')).toBe('page');
  });

  it('marks the debts tab current on a nested debts route', async () => {
    renderAt('/debts/receivables');
    const debts = await within(tabBar()).findByRole('link', { name: /Dettes/ });
    expect(debts.getAttribute('aria-current')).toBe('page');
  });

  it('hides a tab the session has no permission for', async () => {
    vi.stubGlobal(
      'fetch',
      session({ ...OWNER, roles: ['EMPLOYEE'], permissions: [PERMISSIONS.CONTACT_READ] }),
    );
    renderAt('/');
    // Wait for the session to land before asserting on absence, or the
    // assertion passes for the wrong reason (nothing gated has rendered yet).
    await screen.findByText('dashboard-content');
    const bar = tabBar();
    // Dashboard and More are unconditional; Opérations and Dettes are not.
    expect(within(bar).getByRole('link', { name: /Tableau/ })).toBeTruthy();
    expect(within(bar).queryByRole('link', { name: /Opérations/ })).toBeNull();
    expect(within(bar).queryByRole('link', { name: /Dettes/ })).toBeNull();
  });
});

describe('AppShell action sheet', () => {
  it('opens from the FAB with the five daily actions in frequency order', async () => {
    const user = userEvent.setup();
    renderAt('/');
    await user.click(await screen.findByRole('button', { name: /Actions rapides/ }));

    const sheet = screen.getByRole('dialog', { name: /Actions rapides/ });
    // Read the label span, not textContent: the icon span is aria-hidden
    // and must not form part of the item's name.
    const labels = within(sheet)
      .getAllByRole('button')
      .map((b) => b.querySelector('.sheet__label')?.textContent)
      .filter(Boolean);
    expect(labels).toEqual([
      'Acheter des devises',
      'Vendre des devises',
      'Encaisser un règlement',
      'Régler un fournisseur',
      'Saisir une dépense',
    ]);
  });

  it('filters sheet items by permission rather than disabling them', async () => {
    vi.stubGlobal(
      'fetch',
      session({ ...OWNER, roles: ['EMPLOYEE'], permissions: [PERMISSIONS.SALE_CREATE] }),
    );
    const user = userEvent.setup();
    renderAt('/');
    await user.click(await screen.findByRole('button', { name: /Actions rapides/ }));

    const sheet = screen.getByRole('dialog', { name: /Actions rapides/ });
    expect(within(sheet).getByRole('button', { name: /Vendre des devises/ })).toBeTruthy();
    expect(within(sheet).queryByRole('button', { name: /Acheter des devises/ })).toBeNull();
    expect(within(sheet).queryByRole('button', { name: /Saisir une dépense/ })).toBeNull();
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    renderAt('/');
    await user.click(await screen.findByRole('button', { name: /Actions rapides/ }));
    expect(screen.getByRole('dialog', { name: /Actions rapides/ })).toBeTruthy();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: /Actions rapides/ })).toBeNull();
  });
});

describe('AppShell title bar', () => {
  it('shows no back chevron on a root screen', async () => {
    renderAt('/');
    await screen.findByText('dashboard-content');
    expect(screen.queryByRole('button', { name: /Retour/ })).toBeNull();
  });

  it('shows a back chevron on a non-root screen', async () => {
    renderAt('/purchases/abc');
    await screen.findByText('purchase-detail');
    expect(screen.getByRole('button', { name: /Retour/ })).toBeTruthy();
  });

  it('offers the language switcher on every screen, not just the profile page', async () => {
    renderAt('/');
    await screen.findByText('dashboard-content');
    expect(screen.getByRole('group', { name: /Langue|اللغة/ })).toBeTruthy();
  });
});
