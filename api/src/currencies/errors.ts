import { HttpStatus } from '@nestjs/common';
import { DomainError } from '../common/errors/domain.error.js';

export class CurrencyCodeTakenError extends DomainError {
  readonly code = 'currency_code_taken';
  readonly i18nKey = 'error.currency_code_taken';
  readonly status = HttpStatus.CONFLICT;

  constructor(currencyCode: string) {
    super(`currency code already exists: ${currencyCode}`, { code: currencyCode });
  }
}

export class CurrencyNotFoundError extends DomainError {
  readonly code = 'currency_not_found';
  readonly i18nKey = 'error.currency_not_found';
  readonly status = HttpStatus.NOT_FOUND;

  constructor(currencyId: string) {
    super(`currency not found: ${currencyId}`, { id: currencyId });
  }
}

// A currency that has been used cannot be deactivated blindly — from P3
// the check has ledger, cost, and source-row counts. In P2 no such tables
// exist yet, so the service raises this only if the currency's `is_active`
// is already false or (later) if usage is detected.
export class CurrencyInUseError extends DomainError {
  readonly code = 'currency_in_use';
  readonly i18nKey = 'error.currency_in_use';
  readonly status = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor(currencyCode: string, usage: Record<string, number | string>) {
    super(`currency ${currencyCode} still referenced: ${JSON.stringify(usage)}`, {
      code: currencyCode,
      usage,
    });
  }
}
