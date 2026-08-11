import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AppShell } from './AppShell';

// Smoke test: the shell renders its bottom nav (6 items after P5-PR4
// added Debts) and marks the current route as active.

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<div>dashboard-content</div>} />
          <Route path="/purchases" element={<div>purchases-content</div>} />
          <Route path="/sales" element={<div>sales-content</div>} />
          <Route path="/debts/*" element={<div>debts-content</div>} />
          <Route path="/contacts" element={<div>contacts-content</div>} />
          <Route path="/settings/*" element={<div>settings-content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('AppShell', () => {
  it('renders every Phase-5 nav item', () => {
    renderAt('/');
    expect(screen.getByRole('link', { name: /Tableau/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Achats/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Ventes/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Dettes/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Contacts/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Réglages/ })).toBeTruthy();
  });

  it('marks the dashboard link current on /', () => {
    renderAt('/');
    const dashboard = screen.getByRole('link', { name: /Tableau/ });
    expect(dashboard.getAttribute('aria-current')).toBe('page');
  });

  it('marks the settings link current on /settings', () => {
    renderAt('/settings/business');
    const settings = screen.getByRole('link', { name: /Réglages/ });
    expect(settings.getAttribute('aria-current')).toBe('page');
  });
});
