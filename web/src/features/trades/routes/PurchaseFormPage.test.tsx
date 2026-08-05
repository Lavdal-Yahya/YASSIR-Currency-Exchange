import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { act } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PurchaseFormPage } from './PurchaseFormPage';

// P4-14 DoD (phase-4.md §7):
// "Offline banner blocks writes — pressing submit while offline does
// nothing and the button is visibly disabled. Component test passes."

const originalDescriptor = Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine');

function setOnLine(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => value });
}

beforeEach(() => {
  setOnLine(true);
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    ),
  );
});

afterEach(() => {
  if (originalDescriptor) Object.defineProperty(navigator, 'onLine', originalDescriptor);
  vi.restoreAllMocks();
});

function renderForm() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/purchases/new']}>
        <Routes>
          <Route path="/purchases/new" element={<PurchaseFormPage />} />
          <Route path="/purchases" element={<div>list</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PurchaseFormPage — offline submit guard', () => {
  it('submit button is enabled when online', () => {
    renderForm();
    const btn = screen.getByRole('button', { name: /enregistrer/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it('submit button is disabled when offline from mount', () => {
    setOnLine(false);
    renderForm();
    const btn = screen.getByRole('button', { name: /enregistrer/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('submit button becomes disabled when the browser fires "offline"', () => {
    renderForm();
    act(() => {
      setOnLine(false);
      window.dispatchEvent(new Event('offline'));
    });
    const btn = screen.getByRole('button', { name: /enregistrer/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
