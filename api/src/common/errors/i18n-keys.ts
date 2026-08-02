// Registry of every i18n key any error emits. The frontend loads a JSON
// file with these keys in AR and FR; a key missing from either is caught
// by web/test/i18n-parity.test.ts (P1-13).
//
// This file is the single source of truth for backend → frontend i18n
// keys. Adding a new DomainError subclass means adding its key here so
// the test can compare against locales/{ar,fr}.json.
//
// Keys not in ERROR_I18N_KEYS are still allowed to be emitted at
// runtime (nothing prevents it), but the registry lets tools like the
// route-table test also assert coverage.

export const ERROR_I18N_KEYS = [
  // Auth (P1)
  'error.invalid_credentials',
  'error.account_locked',
  'error.too_many_requests',
  'error.unauthorized',
  'error.forbidden',

  // Users (P1 + P2)
  'error.phone_taken',
  'error.unknown_role',

  // Currencies (P2)
  'error.currency_code_taken',
  'error.currency_not_found',
  'error.currency_in_use',

  // Validation (P1)
  'error.validation',
  'error.internal',

  // Ledger + trades (P3+, listed here so P1's frontend can already ship
  // the strings before the endpoints land)
  'error.insufficient_balance',
  'error.payment_exceeds_debt',
  'error.currency_inactive',
  'error.override_denied',
  'error.already_submitted',
  'error.no_base_leg',
  'error.method_note_required',
  'error.rate_service_down',
] as const;

export type ErrorI18nKey = (typeof ERROR_I18N_KEYS)[number];
