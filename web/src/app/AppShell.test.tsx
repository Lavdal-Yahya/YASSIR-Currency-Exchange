import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AppShell } from './AppShell';

// Smoke test: the shell renders its bottom nav (5 items in Phase 2) and
// marks the current route as active. This catches nav-list drift when
// a phase adds an item and forgets the label parity check.

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<div>dashboard-content</div>} />
          <Route path="/contacts" element={<div>contacts-content</div>} />
          <Route path="/currencies" element={<div>currencies-content</div>} />
          <Route path="/users" element={<div>users-content</div>} />
          <Route path="/settings/*" element={<div>settings-content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('AppShell', () => {
  it('renders every Phase-2 nav item', () => {
    renderAt('/');
    expect(screen.getByRole('link', { name: /Tableau/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Contacts/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Devises/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Utilisateurs/ })).toBeTruthy();
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
