import { HttpStatus } from '@nestjs/common';
import { DomainError } from '../common/errors/domain.error.js';

// P4 · trade services. Errors raised above the ledger — before any
// LedgerService.apply call — so the DB triggers stay a last line of
// defence and the operator sees a structured 422 instead of a raw
// check_violation surfaced through a 500.

// D-019. Fired when a trade's two legs are (both base) or (both
// non-base). Rejection at input time is spec §32 in spirit — a plausibly
// wrong deal should not be silently converted with an inferred rate.
export class NoBaseCurrencyLegError extends DomainError {
  readonly code = 'no_base_leg';
  readonly i18nKey = 'error.no_base_leg';
  readonly status = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor(details: {
    deliveredCurrencyCode: string;
    paymentCurrencyCode: string;
    baseCurrencyCode: string;
    /** 'both_base' | 'neither_base' — the operator sees a translated key,
     *  the frontend can render an explanation from the discriminator. */
    reason: 'both_base' | 'neither_base';
  }) {
    super(
      `trade rejected: exactly one leg must be ${details.baseCurrencyCode} (got ${details.deliveredCurrencyCode}/${details.paymentCurrencyCode})`,
      details,
    );
  }
}

// D-023 item 4 + D-024. Fired when the rate/total pair does not satisfy
// `payment_total = delivered_amount × rate` exactly at NUMERIC precision.
// The DB CHECK will refuse the write anyway; the service catches it
// first so the operator sees which figure is off, in their currency.
export class RateTotalMismatchError extends DomainError {
  readonly code = 'rate_total_mismatch';
  readonly i18nKey = 'error.rate_total_mismatch';
  readonly status = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor(details: {
    deliveredAmount: string;
    rate: string;
    providedTotal: string;
    expectedTotal: string;
    paymentCurrencyCode: string;
  }) {
    super(
      `rate/total mismatch: ${details.deliveredAmount} × ${details.rate} = ${details.expectedTotal} ${details.paymentCurrencyCode}, provided ${details.providedTotal}`,
      details,
    );
  }
}

// P4-06. A repeat POST with the same idempotency key and a different
// request body — the client is trying to overwrite a confirmed trade.
// Refuse and cite the original.
export class DuplicateSubmissionError extends DomainError {
  readonly code = 'already_submitted';
  readonly i18nKey = 'error.already_submitted';
  readonly status = HttpStatus.CONFLICT;

  constructor(details: {
    idempotencyKey: string;
    /** The trade row that already exists for this key. */
    existingId: string;
    /** ISO timestamp of the original submission. */
    originalSubmittedAt: string;
  }) {
    super(
      `idempotency key '${details.idempotencyKey}' was already used for a different trade (${details.existingId} at ${details.originalSubmittedAt})`,
      details,
    );
  }
}

// D-020 / P4-04b. Immediate payment > 0 but no payment method was
// supplied. Distinct from PaymentMethodNoteRequiredError (which means
// "a method was chosen but its `requires_note` flag needs a note") —
// this one means "no method was chosen at all". The DB CHECK
// (purchase_method_required_when_paid_check) catches this too; the
// service catches it earlier so the operator sees `method_required`
// instead of a raw constraint violation.
export class PaymentMethodRequiredError extends DomainError {
  readonly code = 'payment_method_required';
  readonly i18nKey = 'error.payment_method_required';
  readonly status = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor(details: { immediatePayment: string; paymentCurrencyCode: string }) {
    super(
      `immediate payment ${details.immediatePayment} ${details.paymentCurrencyCode} requires a payment_method_id`,
      details,
    );
  }
}

// Spec §15.1 — every debt links to a contact. A walk-in trade (no
// contact_id) cannot leave an outstanding balance because there is no
// counterparty to owe money to or from. Full immediate payment is the
// only accepted shape.
export class TradeMissingContactError extends DomainError {
  readonly code = 'trade_missing_contact';
  readonly i18nKey = 'error.trade_missing_contact';
  readonly status = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor(details: { outstandingAmount: string; paymentCurrencyCode: string }) {
    super(
      `walk-in trades (no contact) cannot leave an outstanding balance; got ${details.outstandingAmount} ${details.paymentCurrencyCode}`,
      details,
    );
  }
}
