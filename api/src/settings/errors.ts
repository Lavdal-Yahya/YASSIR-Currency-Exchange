import { HttpStatus } from '@nestjs/common';
import { DomainError } from '../common/errors/domain.error.js';

// The settings row exists for the life of the deployment. If a fresh
// deploy doesn't seed it, every code path that needs it fails cleanly
// with this error, not with an obscure "cannot read property of null".
export class SettingsNotInitializedError extends DomainError {
  readonly code = 'settings_not_initialized';
  readonly i18nKey = 'error.settings_not_initialized';
  readonly status = HttpStatus.SERVICE_UNAVAILABLE;

  constructor() {
    super('settings row (id=1) missing — run the seed');
  }
}

// Go-live is a one-way flip. Once set, the opening-balance edit path
// closes and audit becomes the only way changes appear. Refusing to
// unset it here (rather than the DB) keeps the error human.
export class GoLiveAlreadySetError extends DomainError {
  readonly code = 'go_live_already_set';
  readonly i18nKey = 'error.go_live_already_set';
  readonly status = HttpStatus.CONFLICT;

  constructor(when: Date) {
    super(`go-live already set at ${when.toISOString()}`, { setAt: when.toISOString() });
  }
}

export class InvalidTimezoneError extends DomainError {
  readonly code = 'invalid_timezone';
  readonly i18nKey = 'error.invalid_timezone';
  readonly status = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor(tz: string) {
    super(`unknown IANA timezone: ${tz}`, { timezone: tz });
  }
}

export class BaseCurrencyInactiveError extends DomainError {
  readonly code = 'base_currency_inactive';
  readonly i18nKey = 'error.base_currency_inactive';
  readonly status = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor(code: string) {
    super(`cannot set base currency to inactive currency: ${code}`, { code });
  }
}
