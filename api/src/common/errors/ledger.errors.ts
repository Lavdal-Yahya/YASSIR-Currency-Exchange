import { HttpStatus } from '@nestjs/common';
import { DomainError } from './domain.error.js';

// Errors thrown by LedgerService and CostEngine. Every one has an
// i18n key already registered in i18n-keys.ts so the frontend can
// resolve them today.
//
// The `data` payload on each error carries the numbers the user needs
// to see, in the currency they need to see them in. Never a raw
// exception message — the DomainExceptionFilter strips those.

// D-004 / architecture §3.3. Fired when a movement batch would leave
// a currency's cached_amount below zero and no valid override is
// present. The data payload lets the frontend render an accurate
// "insufficient USD: 400.00 available, 1,000.00 requested" line
// without a round-trip.
export class InsufficientBalanceError extends DomainError {
  readonly code = 'insufficient_balance';
  readonly i18nKey = 'error.insufficient_balance';
  readonly status = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor(details: {
    currencyId: string;
    currencyCode: string;
    available: string;
    requested: string;
  }) {
    super(
      `insufficient balance for ${details.currencyCode}: ${details.available} available, ${details.requested} requested`,
      details,
    );
  }
}

// D-015. Two shapes: the caller lacks the permission, or the override
// is being requested against a non-base currency (never allowed —
// negative quantities have no meaningful weighted-average cost).
export class NegativeBalanceOverrideDeniedError extends DomainError {
  readonly code = 'override_denied';
  readonly i18nKey = 'error.override_denied';
  readonly status = HttpStatus.FORBIDDEN;

  constructor(
    reason: 'not_owner' | 'non_base_currency' | 'reason_required',
    details: Record<string, unknown> = {},
  ) {
    super(`negative-balance override denied: ${reason}`, { reason, ...details });
  }
}

// D-020. The referenced payment method has requires_note=true and no
// note was supplied.
export class PaymentMethodNoteRequiredError extends DomainError {
  readonly code = 'method_note_required';
  readonly i18nKey = 'error.method_note_required';
  readonly status = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor(details: { paymentMethodCode: string }) {
    super(`payment method '${details.paymentMethodCode}' requires a note`, details);
  }
}

// Referenced currency, payment method, or user does not exist — points
// at a service bug, not user input. Kept in this file because it is
// only thrown from LedgerService.
export class LedgerReferenceError extends DomainError {
  readonly code = 'ledger_reference';
  readonly i18nKey = 'error.internal';
  readonly status = HttpStatus.INTERNAL_SERVER_ERROR;

  constructor(what: string, id: string) {
    super(`ledger reference missing: ${what} ${id}`, { what, id });
  }
}

// Contract violation — apply() called incorrectly (empty batch, mixed
// direction on a currency with no amount, etc.). Also an internal
// error, not a user-facing one.
export class LedgerContractError extends DomainError {
  readonly code = 'ledger_contract';
  readonly i18nKey = 'error.internal';
  readonly status = HttpStatus.INTERNAL_SERVER_ERROR;

  constructor(message: string, data: Record<string, unknown> = {}) {
    super(message, data);
  }
}

// Fired when the caller tries to write a movement on an inactive
// currency. Deactivation is a P2 flag; using it here as a hard guard
// prevents accidental writes to a currency the owner has just hidden.
export class InactiveCurrencyError extends DomainError {
  readonly code = 'currency_inactive';
  readonly i18nKey = 'error.currency_inactive';
  readonly status = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor(currencyCode: string) {
    super(`currency ${currencyCode} is inactive`, { code: currencyCode });
  }
}
