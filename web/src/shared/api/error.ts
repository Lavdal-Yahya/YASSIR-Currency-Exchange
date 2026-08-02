// Mirrors the ErrorPayload the API sends (see api/src/common/errors/
// exception.filter.ts). Keeping the shape strictly typed on the browser
// side means every consumer routes through `i18nKey` — not raw messages —
// and the runtime guard rejects anything that does not carry the
// contract, so unexpected server errors surface as such rather than as
// silent `undefined`s in the UI.

export interface ApiErrorPayload {
  code: string;
  i18nKey: string;
  message: string;
  data?: Record<string, unknown>;
  requestId?: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly i18nKey: string;
  readonly data: Record<string, unknown> | undefined;
  readonly requestId: string | undefined;

  constructor(status: number, payload: ApiErrorPayload) {
    super(payload.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = payload.code;
    this.i18nKey = payload.i18nKey;
    this.data = payload.data;
    this.requestId = payload.requestId;
  }
}

export function isApiErrorPayload(value: unknown): value is ApiErrorPayload {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.code === 'string' && typeof v.i18nKey === 'string' && typeof v.message === 'string'
  );
}
