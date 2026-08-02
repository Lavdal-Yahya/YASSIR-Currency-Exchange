import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { API_401_EVENT } from '../api/client';
import { AUTH_ME_KEY, use401Redirect } from './session';

function Wired() {
  const qc = new QueryClient();
  qc.setQueryData(AUTH_ME_KEY, { id: 'u_1', fullName: 'Someone' });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/protected']}>
        <SubscriberRoutes qc={qc} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function Subscriber({ qc }: { qc: QueryClient }) {
  use401Redirect(qc);
  return null;
}

function SubscriberRoutes({ qc }: { qc: QueryClient }) {
  return (
    <>
      <Subscriber qc={qc} />
      <Routes>
        <Route path="/login" element={<div>login-screen</div>} />
        <Route path="/protected" element={<div>protected-page</div>} />
      </Routes>
    </>
  );
}

describe('use401Redirect', () => {
  it('navigates to /login when a 401 event is dispatched', async () => {
    render(<Wired />);
    expect(screen.getByText('protected-page')).toBeTruthy();

    await act(async () => {
      window.dispatchEvent(new CustomEvent(API_401_EVENT));
    });

    expect(screen.getByText('login-screen')).toBeTruthy();
    expect(screen.queryByText('protected-page')).toBeNull();
  });
});
