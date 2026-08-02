import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AppShell } from './AppShell';

// Cheap smoke test: the shell renders its bottom nav with the two P1 items
// and marks the current route as active. This catches nav-list drift when
// a phase adds an item and forgets the label parity check.

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<div>dashboard-content</div>} />
          <Route path="/settings/profile" element={<div>profile-content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('AppShell', () => {
  it('renders both P1 nav items', () => {
    renderAt('/');
    expect(screen.getByRole('link', { name: /Tableau/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Profil/ })).toBeTruthy();
  });

  it('marks the dashboard link current on /', () => {
    renderAt('/');
    const dashboard = screen.getByRole('link', { name: /Tableau/ });
    expect(dashboard.getAttribute('aria-current')).toBe('page');
  });

  it('marks the profile link current on /settings/profile', () => {
    renderAt('/settings/profile');
    const profile = screen.getByRole('link', { name: /Profil/ });
    expect(profile.getAttribute('aria-current')).toBe('page');
  });
});
