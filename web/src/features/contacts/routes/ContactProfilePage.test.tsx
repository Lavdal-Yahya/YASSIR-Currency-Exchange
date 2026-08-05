import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContactProfilePage } from './ContactProfilePage';

// P2-11 DoD (phase-2.md §6, item 8):
// "opening the ContactProfile Phase-4/5 tabs shows the placeholder
// card, not an empty table (component test)."

const sampleContact = {
  id: 'c-1',
  name: 'Ahmed',
  phone: '+22212345678',
  isCustomer: true,
  isSupplier: false,
  isArchived: false,
  notes: null,
  createdAt: '2026-08-02T10:00:00Z',
  updatedAt: '2026-08-02T10:00:00Z',
};

const emptyTrades = { data: [], total: 0 };

// Stub fetch — contact profile reads /contacts/:id and /contacts/:id/trades.
beforeEach(() => {
  const fetchMock = vi.fn(async (url: string) => {
    if (String(url).includes('/trades')) {
      return new Response(JSON.stringify(emptyTrades), {
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

function renderAt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/contacts/c-1']}>
        <Routes>
          <Route path="/contacts/:id" element={<ContactProfilePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ContactProfilePage tabs', () => {
  it('receivables tab renders the phase 5 placeholder card, not an empty table', async () => {
    renderAt();
    // Wait for the contact to load
    const name = await screen.findByRole('heading', { name: /Ahmed/ });
    expect(name).toBeTruthy();

    const receivables = screen.getByRole('tab', { name: /À recevoir/ });
    fireEvent.click(receivables);

    expect(screen.getByText(/à partir de la phase 5/i)).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('trades tab renders the empty-state message (no trades for this contact)', async () => {
    renderAt();
    await screen.findByRole('heading', { name: /Ahmed/ });
    fireEvent.click(screen.getByRole('tab', { name: /Échanges/ }));
    // Wait for the async trades fetch to complete and show empty state.
    expect(await screen.findByText(/Aucun échange/i)).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });
});
