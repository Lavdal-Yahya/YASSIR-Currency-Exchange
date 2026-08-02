import { ApiError, type ApiErrorPayload, isApiErrorPayload } from './error';

// Small fetch wrapper — every request:
//   - is same-origin by default (Vite proxies /api → :3000 in dev,
//     Traefik does the same in prod), so cookies flow without CORS.
//   - carries `credentials: 'include'` so the httpOnly JWT cookie
//     survives even if the deployment ever splits hosts.
//   - throws `ApiError` on non-2xx, so callers write `try/catch` once
//     and get the domain shape (i18nKey, data).
//
// 401 handling is *not* inside `request()` — that would couple the
// transport to the router. Instead, a top-level subscriber (see
// use401Redirect in ../session/session.ts) reacts to any 401 event on
// the shared bus. That keeps this file testable without a router.

export const API_401_EVENT = 'api:unauthorized';

const API_PREFIX = '/api/v1';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, headers = {}, signal } = options;
  const url = path.startsWith('http') ? path : `${API_PREFIX}${path}`;

  const init: RequestInit = {
    method,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    ...(signal ? { signal } : {}),
  };

  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (cause) {
    // Network failure — no response arrived. Surface with a stable code
    // so the UI can render "check your connection" without introspecting
    // the browser's opaque TypeError.
    throw new ApiError(0, {
      code: 'network',
      i18nKey: 'errors.network',
      message: (cause as Error)?.message ?? 'Network error',
    });
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const isJson = (res.headers.get('content-type') ?? '').includes('application/json');
  const payload: unknown = isJson ? await res.json().catch(() => undefined) : undefined;

  if (!res.ok) {
    // Broadcast BEFORE throwing — subscribers get to invalidate the
    // auth cache and redirect while the caller's catch runs its own
    // cleanup. This is fire-and-forget; do not await.
    if (res.status === 401 && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(API_401_EVENT));
    }

    if (isApiErrorPayload(payload)) {
      throw new ApiError(res.status, payload);
    }

    // The server did not send our envelope — something upstream (a proxy,
    // a browser-generated error page) intercepted. Normalize to the same
    // shape so callers still get an ApiError.
    throw new ApiError(res.status, {
      code: 'unknown',
      i18nKey: 'errors.unknown',
      message: `HTTP ${res.status}`,
    } satisfies ApiErrorPayload);
  }

  return payload as T;
}
