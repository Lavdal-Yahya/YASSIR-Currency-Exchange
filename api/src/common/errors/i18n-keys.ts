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

  // Settings (P2)
  'error.settings_not_initialized',
  'error.go_live_already_set',
  'error.invalid_timezone',
  'error.base_currency_inactive',

  // Payment methods (P2, D-020)
  'error.payment_method_code_taken',
  'error.payment_method_not_found',
  'error.cannot_deactivate_cash',

  // Contacts (P2-03)
  'error.contact_not_found',
  'error.duplicate_phone',
  'error.contact_role_required',

  // Expense categories (P2-04)
  'error.expense_category_not_found',
  'error.expense_category_name_taken',

  // User management (P2-06)
  'error.user_not_found',
  'error.cannot_deactivate_self',
  'error.cannot_strip_own_owner_role',

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
  // D-024 — rate/total strict equality
  'error.rate_total_mismatch',
  // P4 trade services (D-020 + spec §15.1)
  'error.payment_method_required',
  'error.trade_missing_contact',

  // Openings (P3-08 → P3-10)
  'error.opening_after_go_live',
  'error.opening_already_exists',
  'error.opening_not_found',
] as const;

export type ErrorI18nKey = (typeof ERROR_I18N_KEYS)[number];
