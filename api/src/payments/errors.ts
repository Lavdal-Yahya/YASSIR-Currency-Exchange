import { HttpStatus } from '@nestjs/common';
import { DomainError } from '../common/errors/domain.error.js';

// P5 · payment / debt errors. Raised above the ledger so operators see
// structured 422s instead of raw constraint violations.

// Spec §15.4 — attempting to pay more than the total outstanding across
// all active receivables in the same currency.
export class PaymentExceedsOutstandingError extends DomainError {
  readonly code = 'payment_exceeds_outstanding';
  readonly i18nKey = 'error.payment_exceeds_outstanding';
  readonly status = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor(details: { requested: string; outstanding: string; currencyCode: string }) {
    super(
      `payment ${details.requested} ${details.currencyCode} exceeds total outstanding ${details.outstanding} ${details.currencyCode}`,
      details,
    );
  }
}

// Spec §15.2 — paying a debt in a different currency from the debt's own
// currency. Cross-currency settlement is explicitly forbidden.
export class CrossCurrencyPaymentError extends DomainError {
  readonly code = 'cross_currency_payment';
  readonly i18nKey = 'error.cross_currency_payment';
  readonly status = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor(details: { paymentCurrencyCode: string; debtCurrencyCode: string }) {
    super(
      `cannot settle a ${details.debtCurrencyCode} debt with ${details.paymentCurrencyCode} — cross-currency settlement is not allowed (spec §15.2)`,
      details,
    );
  }
}

// Customer payment directed at a contact that has isCustomer=false.
export class ContactNotCustomerError extends DomainError {
  readonly code = 'contact_not_customer';
  readonly i18nKey = 'error.contact_not_customer';
  readonly status = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor(contactId: string) {
    super(`contact ${contactId} is not flagged as a customer`, { id: contactId });
  }
}

// No active receivables exist for the given contact + currency, so
// there is nothing to pay down.
export class NoActiveReceivablesError extends DomainError {
  readonly code = 'no_active_receivables';
  readonly i18nKey = 'error.no_active_receivables';
  readonly status = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor(details: { contactId: string; currencyCode: string }) {
    super(
      `no active receivables for contact ${details.contactId} in ${details.currencyCode}`,
      details,
    );
  }
}

// Non-base currency payment requires a unit cost for the WAC book.
// Thrown when the payment currency is not MRU and no WAC can be derived.
export class NonBaseCurrencyPaymentNeedsRateError extends DomainError {
  readonly code = 'non_base_payment_needs_rate';
  readonly i18nKey = 'error.non_base_payment_needs_rate';
  readonly status = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor(details: { currencyCode: string }) {
    super(
      `payment in ${details.currencyCode} requires a unit_cost_mru — no existing position to derive a WAC from`,
      details,
    );
  }
}
