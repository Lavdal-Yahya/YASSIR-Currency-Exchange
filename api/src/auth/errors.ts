import { HttpException, HttpStatus } from '@nestjs/common';

// P1-09 replaces these with the domain-error base + exception filter and
// i18n key mapping. Until then, thin HttpException subclasses carry the
// same shape ({ code, i18nKey, ...data }) so the frontend contract does
// not change when the swap happens.

interface ErrorBody {
  code: string;
  i18nKey: string;
  message: string;
  data?: Record<string, unknown>;
}

export class InvalidCredentialsError extends HttpException {
  constructor() {
    const body: ErrorBody = {
      code: 'invalid_credentials',
      i18nKey: 'error.invalid_credentials',
      // The message is deliberately the same for wrong phone, wrong PIN,
      // inactive account, and locked account — phase-1.md §3 requires that
      // account enumeration is not leakable via the error payload.
      message: 'Invalid credentials.',
    };
    super(body, HttpStatus.UNAUTHORIZED);
  }
}

export class AccountLockedError extends HttpException {
  constructor(lockedUntil: Date) {
    const body: ErrorBody = {
      code: 'account_locked',
      i18nKey: 'error.account_locked',
      message: 'Account temporarily locked.',
      data: { lockedUntil: lockedUntil.toISOString() },
    };
    super(body, HttpStatus.UNAUTHORIZED);
  }
}
