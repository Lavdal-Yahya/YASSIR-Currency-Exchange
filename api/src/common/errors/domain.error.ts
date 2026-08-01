import type { HttpStatus } from '@nestjs/common';

// Base class for every business-rule error. Carries three things:
//   - `code`      a stable machine identifier the frontend can switch on
//   - `i18nKey`   the translation key both AR and FR must ship
//   - `data`      structured context — "400.00 available, 1000.00 requested"
//
// The controller layer never wraps or transforms these. The
// DomainExceptionFilter serialises them to HTTP with no stack trace on
// the wire (spec §42), so nothing about the internal call graph leaks.
//
// Rules of thumb (architecture §3.8):
//   - Every business error is a subclass here, not a raw `throw new
//     Error(...)`.
//   - The `data` payload carries the numbers the user needs to see, in
//     the currency they need to see them in.
//   - The `message` is a fallback; the frontend renders `i18nKey`
//     translated. Keep it human but not authoritative.
export abstract class DomainError extends Error {
  abstract readonly code: string;
  abstract readonly i18nKey: string;
  abstract readonly status: HttpStatus;
  readonly data: Record<string, unknown>;

  constructor(message: string, data: Record<string, unknown> = {}) {
    super(message);
    this.name = this.constructor.name;
    this.data = data;
  }
}
