// Mirror of api/src/common/permissions.ts — hand-kept in sync.
//
// The backend owns the source of truth (compile errors + PermissionGuard
// depend on it). The web needs the same list to render the permission
// matrix. When adding a new permission you MUST update both files in the
// same commit; the i18n parity test does not catch this, so review is
// the guardrail. See phase-2.md §5 note on how the matrix is built.

export const PERMISSIONS = {
  USER_READ: 'user:read',
  USER_CREATE: 'user:create',
  USER_MANAGE: 'user:manage',
  USER_RESET_PIN: 'user:reset_pin',

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

  BALANCE_READ: 'balance:read',
  BALANCE_OVERRIDE: 'balance:override',
  LEDGER_READ: 'ledger:read',
  OPENING_READ: 'opening:read',
  OPENING_MANAGE: 'opening:manage',
  OPENING_ADJUST_POST_GOLIVE: 'opening:adjust_post_golive',

  PURCHASE_READ: 'purchase:read',
  PURCHASE_CREATE: 'purchase:create',
  SALE_READ: 'sale:read',
  SALE_CREATE: 'sale:create',
  PROFIT_VIEW: 'profit:view',

  RECEIVABLE_READ: 'receivable:read',
  PAYABLE_READ: 'payable:read',
  PAYMENT_READ: 'payment:read',
  PAYMENT_RECEIVE: 'payment:receive',
  PAYMENT_PAY: 'payment:pay',
  EXPENSE_READ: 'expense:read',
  EXPENSE_CREATE: 'expense:create',

  REPORT_VIEW: 'report:view',
  REVERSAL_TRADE: 'reversal:trade',
  REVERSAL_PAYMENT: 'reversal:payment',
  REVERSAL_EXPENSE: 'reversal:expense',
  AUDIT_READ: 'audit:read',

  RATE_READ: 'rate:read',
  RATE_MANAGE: 'rate:manage',
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

// Grouping for the matrix UI. Groups match the comment sections in the
// backend file. Keeps rendering coherent as the list grows.
export const PERMISSION_GROUPS: { label: string; codes: PermissionCode[] }[] = [
  {
    label: 'users',
    codes: [
      PERMISSIONS.USER_READ,
      PERMISSIONS.USER_CREATE,
      PERMISSIONS.USER_MANAGE,
      PERMISSIONS.USER_RESET_PIN,
    ],
  },
  {
    label: 'master_data',
    codes: [
      PERMISSIONS.CURRENCY_READ,
      PERMISSIONS.CURRENCY_MANAGE,
      PERMISSIONS.CONTACT_READ,
      PERMISSIONS.CONTACT_MANAGE,
      PERMISSIONS.EXPENSE_CATEGORY_READ,
      PERMISSIONS.EXPENSE_CATEGORY_MANAGE,
      PERMISSIONS.PAYMENT_METHOD_READ,
      PERMISSIONS.PAYMENT_METHOD_MANAGE,
      PERMISSIONS.SETTINGS_READ,
      PERMISSIONS.SETTINGS_MANAGE,
      PERMISSIONS.SETTINGS_GO_LIVE,
    ],
  },
  {
    label: 'ledger',
    codes: [
      PERMISSIONS.BALANCE_READ,
      PERMISSIONS.BALANCE_OVERRIDE,
      PERMISSIONS.LEDGER_READ,
      PERMISSIONS.OPENING_READ,
      PERMISSIONS.OPENING_MANAGE,
      PERMISSIONS.OPENING_ADJUST_POST_GOLIVE,
    ],
  },
  {
    label: 'trades',
    codes: [
      PERMISSIONS.PURCHASE_READ,
      PERMISSIONS.PURCHASE_CREATE,
      PERMISSIONS.SALE_READ,
      PERMISSIONS.SALE_CREATE,
      PERMISSIONS.PROFIT_VIEW,
    ],
  },
  {
    label: 'debts',
    codes: [
      PERMISSIONS.RECEIVABLE_READ,
      PERMISSIONS.PAYABLE_READ,
      PERMISSIONS.PAYMENT_READ,
      PERMISSIONS.PAYMENT_RECEIVE,
      PERMISSIONS.PAYMENT_PAY,
      PERMISSIONS.EXPENSE_READ,
      PERMISSIONS.EXPENSE_CREATE,
    ],
  },
  {
    label: 'reports',
    codes: [
      PERMISSIONS.REPORT_VIEW,
      PERMISSIONS.REVERSAL_TRADE,
      PERMISSIONS.REVERSAL_PAYMENT,
      PERMISSIONS.REVERSAL_EXPENSE,
      PERMISSIONS.AUDIT_READ,
    ],
  },
  {
    label: 'rates',
    codes: [PERMISSIONS.RATE_READ, PERMISSIONS.RATE_MANAGE],
  },
];

// Owner default matches OWNER_PERMISSIONS on the backend (all).
// Employee default matches EMPLOYEE_PERMISSIONS. These reflect the seed
// and are shown read-only in the matrix; per-user role editing lives on
// UserFormPage. This is *not* a role editor.
export const DEFAULT_OWNER_PERMISSIONS: readonly PermissionCode[] = Object.values(PERMISSIONS);
export const DEFAULT_EMPLOYEE_PERMISSIONS: readonly PermissionCode[] = [
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
