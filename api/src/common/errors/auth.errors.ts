import { HttpStatus } from '@nestjs/common';
import { DomainError } from './domain.error.js';

// Same message for every failure mode of login (unknown phone, wrong
// PIN, inactive account) so the HTTP payload does not distinguish them
// — enumeration guard. AccountLockedError is distinct because lockout
// is only surfaced *after* PIN verification succeeds, so probing does
// not reveal whether an account is locked.

export class InvalidCredentialsError extends DomainError {
  readonly code = 'invalid_credentials';
  readonly i18nKey = 'error.invalid_credentials';
  readonly status = HttpStatus.UNAUTHORIZED;
  constructor() {
    super('Invalid credentials.');
  }
}

export class AccountLockedError extends DomainError {
  readonly code = 'account_locked';
  readonly i18nKey = 'error.account_locked';
  readonly status = HttpStatus.UNAUTHORIZED;
  constructor(lockedUntil: Date) {
    super('Account temporarily locked.', { lockedUntil: lockedUntil.toISOString() });
  }
}
