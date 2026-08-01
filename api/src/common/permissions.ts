// Single source of truth for every permission code the API checks.
//
// Rules (phase-1.md §3):
//   - Adding a permission = add a line here + a row in the seed script.
//     Nothing else. String literals scattered across controllers get
//     rejected in review.
//   - The route-table test (P1-07) refuses any controller method that
//     lacks either @RequirePermission(<code>) or @Public.
//   - The @RequirePermission decorator's argument type is `PermissionCode`
//     — a typo becomes a compile error, not a silent security hole.
//
// Grouped by domain area. Adding a new area? Append; do not renumber.

export const PERMISSIONS = {
  // --- users & auth (P1) ---------------------------------------------
  USER_READ: 'user:read',
  USER_CREATE: 'user:create',
  USER_MANAGE: 'user:manage',
  USER_RESET_PIN: 'user:reset_pin',

  // --- master data (P2) ----------------------------------------------
  CURRENCY_READ: 'currency:read',
  CURRENCY_MANAGE: 'currency:manage',
  CONTACT_READ: 'contact:read',
  CONTACT_MANAGE: 'contact:manage',
  EXPENSE_CATEGORY_READ: 'expense_category:read',
  EXPENSE_CATEGORY_MANAGE: 'expense_category:manage',
  PAYMENT_METHOD_READ: 'payment_method:read',
  PAYMENT_METHOD_MANAGE: 'payment_method:manage',
  SETTINGS_READ: 'settings:read',
  SETTINGS_MANAGE: 'settings:manage',
  SETTINGS_GO_LIVE: 'settings:go_live',

  // --- ledger core (P3) ----------------------------------------------
  BALANCE_READ: 'balance:read',
  BALANCE_OVERRIDE: 'balance:override', // D-015 negative-balance override (owner only, MRU only)
  LEDGER_READ: 'ledger:read',
  OPENING_READ: 'opening:read',
  OPENING_MANAGE: 'opening:manage',
  OPENING_ADJUST_POST_GOLIVE: 'opening:adjust_post_golive',

  // --- trades (P4) ---------------------------------------------------
  PURCHASE_READ: 'purchase:read',
  PURCHASE_CREATE: 'purchase:create',
  SALE_READ: 'sale:read',
  SALE_CREATE: 'sale:create',
  PROFIT_VIEW: 'profit:view', // D-018 — enforced in the serializer, not just the route

  // --- debts, settlements, expenses (P5) -----------------------------
  RECEIVABLE_READ: 'receivable:read',
  PAYABLE_READ: 'payable:read',
  PAYMENT_READ: 'payment:read',
  PAYMENT_RECEIVE: 'payment:receive',
  PAYMENT_PAY: 'payment:pay',
  EXPENSE_READ: 'expense:read',
  EXPENSE_CREATE: 'expense:create',

  // --- profit, reversal, audit (P6) ----------------------------------
  REPORT_VIEW: 'report:view',
  REVERSAL_TRADE: 'reversal:trade',
  REVERSAL_PAYMENT: 'reversal:payment',
  REVERSAL_EXPENSE: 'reversal:expense',
  AUDIT_READ: 'audit:read',

  // --- rates (P8) ----------------------------------------------------
  RATE_READ: 'rate:read',
  RATE_MANAGE: 'rate:manage',
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

// Flat array — useful for the seed script (which inserts every row) and
// the route-table test's completeness check.
export const ALL_PERMISSIONS: readonly PermissionCode[] = Object.values(PERMISSIONS);

// Employees can operate the till: log in, look up contacts, record trades,
// take/pay debts, add expenses. They cannot see profit (D-018), reverse
// anything, override negative balances, or manage users/settings.
//
// The seed script uses this to bootstrap the EMPLOYEE role. It is not
// checked at runtime — a role is defined by its rows in `role_permission`,
// not by this constant. Editing the constant does not change what a
// deployed employee can do; re-running the seed with a fresh set does.
export const EMPLOYEE_PERMISSIONS: readonly PermissionCode[] = [
  PERMISSIONS.CURRENCY_READ,
  PERMISSIONS.CONTACT_READ,
  PERMISSIONS.CONTACT_MANAGE,
  PERMISSIONS.EXPENSE_CATEGORY_READ,
  PERMISSIONS.PAYMENT_METHOD_READ,
  PERMISSIONS.BALANCE_READ,
  PERMISSIONS.LEDGER_READ,
  PERMISSIONS.PURCHASE_READ,
  PERMISSIONS.PURCHASE_CREATE,
  PERMISSIONS.SALE_READ,
  PERMISSIONS.SALE_CREATE,
  PERMISSIONS.RECEIVABLE_READ,
  PERMISSIONS.PAYABLE_READ,
  PERMISSIONS.PAYMENT_READ,
  PERMISSIONS.PAYMENT_RECEIVE,
  PERMISSIONS.PAYMENT_PAY,
  PERMISSIONS.EXPENSE_READ,
  PERMISSIONS.EXPENSE_CREATE,
  PERMISSIONS.REPORT_VIEW,
  PERMISSIONS.RATE_READ,
];

// Owner sees everything, always.
export const OWNER_PERMISSIONS: readonly PermissionCode[] = ALL_PERMISSIONS;

export const ROLE_CODES = {
  OWNER: 'OWNER',
  EMPLOYEE: 'EMPLOYEE',
} as const;

export type RoleCode = (typeof ROLE_CODES)[keyof typeof ROLE_CODES];
