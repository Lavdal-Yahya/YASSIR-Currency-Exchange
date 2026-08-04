import { HttpStatus } from '@nestjs/common';
import { DomainError } from '../common/errors/domain.error.js';

// P3-10 — go-live lock. Once settings.go_live_at is non-null the
// openings endpoints refuse new writes; the "reduce to zero then hide"
// UX flow assumes the opening is set once and never after.
export class OpeningAfterGoLiveError extends DomainError {
  readonly code = 'opening_after_go_live';
  readonly i18nKey = 'error.opening_after_go_live';
  readonly status = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor(details: { goLiveAt: string } = { goLiveAt: '' }) {
    super('openings are locked after go-live', details);
  }
}

// A currency can have at most one opening balance (schema-review §3.1
// unique index). The service catches the second attempt before the
// unique index fires to produce a friendly error.
export class OpeningAlreadyExistsError extends DomainError {
  readonly code = 'opening_already_exists';
  readonly i18nKey = 'error.opening_already_exists';
  readonly status = HttpStatus.CONFLICT;

  constructor(currencyCode: string) {
    super(`opening balance already exists for ${currencyCode}`, { currencyCode });
  }
}

export class OpeningNotFoundError extends DomainError {
  readonly code = 'opening_not_found';
  readonly i18nKey = 'error.opening_not_found';
  readonly status = HttpStatus.NOT_FOUND;

  constructor(id: string) {
    super(`opening not found: ${id}`, { id });
  }
}
