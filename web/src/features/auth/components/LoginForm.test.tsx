import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginForm } from './LoginForm';

function wrap(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LoginForm', () => {
  it('rejects an invalid phone before hitting the network', async () => {
    const user = userEvent.setup();
    wrap(<LoginForm />);

    await user.type(screen.getByLabelText(/Numéro/i), '12345');
    await user.type(screen.getByLabelText(/PIN/i), '1234');
    await user.click(screen.getByRole('button', { name: /Se connecter/i }));

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts credentials with an httpOnly-friendly request on submit', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 204,
      headers: { get: () => null },
    } as unknown as Response);

    const user = userEvent.setup();
    const onSuccess = vi.fn();
    wrap(<LoginForm onSuccess={onSuccess} />);

    await user.type(screen.getByLabelText(/Numéro/i), '+22212345678');
    await user.type(screen.getByLabelText(/PIN/i), '1234');
    await user.click(screen.getByRole('button', { name: /Se connecter/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/auth/login');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(init.body).toBe('{"phone":"+22212345678","pin":"1234"}');
  });

  it('renders the server error i18n key mapped to the FR string', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      headers: { get: () => 'application/json' },
      json: async () => ({
        code: 'invalid_credentials',
        i18nKey: 'error.invalid_credentials',
        message: 'ignored',
      }),
    } as unknown as Response);

    const user = userEvent.setup();
    wrap(<LoginForm />);

    await user.type(screen.getByLabelText(/Numéro/i), '+22212345678');
    await user.type(screen.getByLabelText(/PIN/i), '1234');
    await user.click(screen.getByRole('button', { name: /Se connecter/i }));

    await waitFor(() => {
      expect(screen.getByText(/Numéro ou code incorrect/i)).toBeTruthy();
    });
  });
});
