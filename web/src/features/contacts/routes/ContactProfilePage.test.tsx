import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContactProfilePage } from './ContactProfilePage';
import { PageTitleProvider } from '../../../app/PageTitle';

// Phase 5 (P5-11) supersedes the phase-2 placeholder test: the
// receivables/payables tabs have been merged into a single "debts" tab
// backed by SideBySideDebtsPanel, which renders both columns unnetted
// with a visible explanatory note (spec §17).

const sampleContact = {
  id: 'c-1',
  name: 'Ahmed',
  phone: '+22212345678',
  isCustomer: true,
  isSupplier: true,
  isArchived: false,
  notes: null,
  createdAt: '2026-08-02T10:00:00Z',
  updatedAt: '2026-08-02T10:00:00Z',
};

const emptyList = { data: [], total: 0 };

beforeEach(() => {
  const fetchMock = vi.fn(async (url: string) => {
    const s = String(url);
    if (s.includes('/receivables') || s.includes('/payables') || s.includes('/trades')) {
      return new Response(JSON.stringify(emptyList), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (s.includes('/currencies')) {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify(sampleContact), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
});

// The screen title is published to the shell's title bar rather than
// rendered as an in-body <h1> (see app/PageTitle.tsx), so a page rendered
// in isolation needs somewhere to publish it.
function renderAt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const titles: (string | null)[] = [];
  render(
    <QueryClientProvider client={qc}>
      <PageTitleProvider value={(title) => titles.push(title)}>
        <MemoryRouter initialEntries={['/contacts/c-1']}>
          <Routes>
            <Route path="/contacts/:id" element={<ContactProfilePage />} />
          </Routes>
        </MemoryRouter>
      </PageTitleProvider>
    </QueryClientProvider>,
  );
  return { titles };
}

describe('ContactProfilePage tabs', () => {
  it('debts tab shows the unnetted explanatory note and both columns', async () => {
    const { titles } = renderAt();
    const debtsTabEl = await screen.findByRole('tab', { name: /Dettes/ });
    expect(debtsTabEl).toBeTruthy();
    // The contact's name is what the title bar shows for this screen.
    expect(titles).toContain('Ahmed');

    fireEvent.click(debtsTabEl);

    // The unnetted note is on-screen, not in a tooltip (spec §17).
    expect(await screen.findByRole('note')).toBeTruthy();
    // Two column headings, one per side.
    expect(screen.getByRole('region', { name: /À recevoir/i })).toBeTruthy();
    expect(screen.getByRole('region', { name: /À payer/i })).toBeTruthy();
  });

  it('trades tab renders the empty-state message (no trades for this contact)', async () => {
    renderAt();
    fireEvent.click(await screen.findByRole('tab', { name: /Échanges/ }));
    expect(await screen.findByText(/Aucun échange/i)).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });
});
