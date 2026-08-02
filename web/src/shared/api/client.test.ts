import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_401_EVENT, request } from './client';
import { ApiError } from './error';

// Global fetch is mocked per test so we exercise the wrapper's own
// behavior (envelope parsing, 401 broadcast, error normalization)
// without a network trip.

interface FakeInit {
  ok: boolean;
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
}

function fakeResponse({ ok, status, headers = {}, body }: FakeInit): Response {
  const contentType = headers['content-type'] ?? (body !== undefined ? 'application/json' : '');
  return {
    ok,
    status,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null),
    },
    json: async () => body,
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;
let events: string[];
let onEvent: () => void;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  events = [];
  onEvent = () => events.push('401');
  window.addEventListener(API_401_EVENT, onEvent);
});

afterEach(() => {
  window.removeEventListener(API_401_EVENT, onEvent);
  vi.unstubAllGlobals();
});

describe('request()', () => {
  it('resolves JSON on 200', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse({ ok: true, status: 200, body: { hello: 'world' } }),
    );
    const result = await request<{ hello: string }>('/ping');
    expect(result.hello).toBe('world');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/ping',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('resolves undefined on 204', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse({ ok: true, status: 204 }));
    const result = await request<void>('/auth/logout', { method: 'POST' });
    expect(result).toBeUndefined();
  });

  it('serializes a JSON body and sets Content-Type', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse({ ok: true, status: 200, body: {} }));
    await request('/auth/login', { method: 'POST', body: { phone: '+222', pin: '0000' } });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"phone":"+222","pin":"0000"}');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('throws ApiError carrying the domain envelope', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse({
        ok: false,
        status: 422,
        body: {
          code: 'insufficient_balance',
          i18nKey: 'error.insufficient_balance',
          message: 'Only 400.00 USD available',
          data: { available: '400.00' },
          requestId: 'abc123',
        },
      }),
    );

    await expect(request('/anything', { method: 'POST', body: {} })).rejects.toMatchObject({
      name: 'ApiError',
      status: 422,
      code: 'insufficient_balance',
      i18nKey: 'error.insufficient_balance',
      data: { available: '400.00' },
      requestId: 'abc123',
    });
  });

  it('broadcasts a 401 event so subscribers can redirect', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse({
        ok: false,
        status: 401,
        body: { code: 'unauthorized', i18nKey: 'error.unauthorized', message: 'Nope' },
      }),
    );

    await expect(request('/protected')).rejects.toBeInstanceOf(ApiError);
    expect(events).toEqual(['401']);
  });

  it('normalizes a non-envelope error body to a stable shape', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse({ ok: false, status: 502, body: '<html>bad gateway</html>' }),
    );

    await expect(request('/anything')).rejects.toMatchObject({
      status: 502,
      code: 'unknown',
      i18nKey: 'errors.unknown',
    });
  });

  it('wraps a network failure in ApiError with code=network', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expect(request('/anything')).rejects.toMatchObject({
      status: 0,
      code: 'network',
      i18nKey: 'errors.network',
    });
  });
});
