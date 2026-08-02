import { HttpStatus } from '@nestjs/common';
import { DomainError } from '../common/errors/domain.error.js';

export class PaymentMethodCodeTakenError extends DomainError {
  readonly code = 'payment_method_code_taken';
  readonly i18nKey = 'error.payment_method_code_taken';
  readonly status = HttpStatus.CONFLICT;

  constructor(methodCode: string) {
    super(`payment method code already exists: ${methodCode}`, { code: methodCode });
  }
}

export class PaymentMethodNotFoundError extends DomainError {
  readonly code = 'payment_method_not_found';
  readonly i18nKey = 'error.payment_method_not_found';
  readonly status = HttpStatus.NOT_FOUND;

  constructor(id: string) {
    super(`payment method not found: ${id}`, { id });
  }
}

// CASH is the ultimate fallback method. If it's deactivated, a currency
// bureau can't accept walk-in cash, which is the business. Refuse it at
// the service; the DB layer has no way to know CASH is special.
export class CannotDeactivateCashError extends DomainError {
  readonly code = 'cannot_deactivate_cash';
  readonly i18nKey = 'error.cannot_deactivate_cash';
  readonly status = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor() {
    super('the CASH payment method cannot be deactivated');
  }
}
