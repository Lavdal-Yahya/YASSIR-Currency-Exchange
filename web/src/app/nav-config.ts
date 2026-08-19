import { PERMISSIONS, type PermissionCode } from '../shared/permissions';

// The navigation model, in one place.
//
// Shape comes from the design handoff (`screens.md` §1 and
// `design_handoff_exchange_bureau/README.md` "Bottom tab bar"):
//
//   Accueil ▤ · Opérations ⇄ · [FAB +] · Dettes ≡ · Plus ⋯
//
// Five slots, never six — a sixth turns the bar into a menu, which is
// exactly what `Plus` is. Everything that does not earn a tab lives in
// MORE_GROUPS, and the five daily *create* actions live in the action
// sheet behind the FAB.
//
// `anyOf: []` means "always visible". Otherwise the entry renders when
// the session holds at least one of the listed permissions. This is a
// courtesy filter — the API guard is the enforcement point
// (architecture §4).

export interface NavEntry {
  to: string;
  labelKey: string;
  icon: string;
  /** Visible when the session holds any of these. Empty = always. */
  anyOf: PermissionCode[];
  /** Exact-match the route (used for `/`). */
  end?: boolean;
}

export interface NavGroup {
  labelKey: string;
  entries: NavEntry[];
}

// --- the four tab slots (the fifth is the FAB, rendered separately) ---

export const TAB_ITEMS: NavEntry[] = [
  { to: '/', labelKey: 'nav.dashboard', icon: '▤', anyOf: [], end: true },
  {
    to: '/operations',
    labelKey: 'nav.operations',
    icon: '⇄',
    anyOf: [PERMISSIONS.PURCHASE_READ, PERMISSIONS.SALE_READ],
  },
  {
    to: '/debts',
    labelKey: 'nav.debts',
    icon: '≡',
    anyOf: [PERMISSIONS.RECEIVABLE_READ, PERMISSIONS.PAYABLE_READ],
  },
  { to: '/more', labelKey: 'nav.more', icon: '⋯', anyOf: [] },
];

// --- the action sheet behind the FAB ---------------------------------
//
// Order is fixed by the design and is the order of daily frequency:
// buy · sell · receive · pay · expense.
//
// Receive/pay target the debt *lists* rather than a form: the forms are
// `/debts/receivables/:id/receive` and need a specific debt, so the
// operator picks the debt first. Buy/sell/expense go straight to their
// form because nothing needs picking.

export const QUICK_ACTIONS: NavEntry[] = [
  {
    to: '/purchases/new',
    labelKey: 'nav.action_buy',
    icon: '↙',
    anyOf: [PERMISSIONS.PURCHASE_CREATE],
  },
  { to: '/sales/new', labelKey: 'nav.action_sell', icon: '↗', anyOf: [PERMISSIONS.SALE_CREATE] },
  {
    to: '/debts/receivables',
    labelKey: 'nav.action_receive',
    icon: '⇣',
    anyOf: [PERMISSIONS.PAYMENT_RECEIVE],
  },
  {
    to: '/debts/payables',
    labelKey: 'nav.action_pay',
    icon: '⇡',
    anyOf: [PERMISSIONS.PAYMENT_PAY],
  },
  {
    to: '/expenses/new',
    labelKey: 'nav.action_expense',
    icon: '−',
    anyOf: [PERMISSIONS.EXPENSE_CREATE],
  },
];

// --- the More menu ----------------------------------------------------
//
// Everything reachable that is not a tab and not a daily create action.
// Before this existed, /expenses, /currencies, /users and /payments had
// no inbound link anywhere in the app — they were reachable only by
// typing the URL.

export const MORE_GROUPS: NavGroup[] = [
  {
    labelKey: 'nav.group_people',
    entries: [
      { to: '/contacts', labelKey: 'nav.contacts', icon: '☺', anyOf: [PERMISSIONS.CONTACT_READ] },
    ],
  },
  {
    labelKey: 'nav.group_money',
    entries: [
      { to: '/expenses', labelKey: 'nav.expenses', icon: '−', anyOf: [PERMISSIONS.EXPENSE_READ] },
      { to: '/payments', labelKey: 'nav.payments', icon: '✓', anyOf: [PERMISSIONS.PAYMENT_READ] },
      { to: '/balances', labelKey: 'nav.balances', icon: '≡', anyOf: [PERMISSIONS.BALANCE_READ] },
      { to: '/openings', labelKey: 'nav.openings', icon: '⌂', anyOf: [PERMISSIONS.OPENING_READ] },
    ],
  },
  {
    labelKey: 'nav.group_currencies',
    entries: [
      {
        to: '/currencies',
        labelKey: 'nav.currencies',
        icon: '¤',
        anyOf: [PERMISSIONS.CURRENCY_READ],
      },
      { to: '/rates', labelKey: 'nav.rates', icon: '~', anyOf: [PERMISSIONS.RATE_READ] },
    ],
  },
  {
    labelKey: 'nav.group_reports',
    entries: [
      {
        to: '/reports/profit',
        labelKey: 'nav.report_profit',
        icon: '↗',
        anyOf: [PERMISSIONS.PROFIT_VIEW],
      },
      {
        to: '/reports/cash-flow',
        labelKey: 'nav.report_cash_flow',
        icon: '⇄',
        anyOf: [PERMISSIONS.REPORT_VIEW],
      },
      {
        to: '/reports/ageing',
        labelKey: 'nav.report_ageing',
        icon: '◷',
        anyOf: [PERMISSIONS.REPORT_VIEW],
      },
      {
        to: '/reports/user-activity',
        labelKey: 'nav.report_user_activity',
        icon: '☺',
        anyOf: [PERMISSIONS.AUDIT_READ],
      },
    ],
  },
  {
    labelKey: 'nav.group_admin',
    entries: [
      { to: '/users', labelKey: 'nav.users', icon: '☺', anyOf: [PERMISSIONS.USER_READ] },
      { to: '/audit', labelKey: 'nav.audit', icon: '◷', anyOf: [PERMISSIONS.AUDIT_READ] },
      { to: '/settings', labelKey: 'nav.settings', icon: '⚙', anyOf: [PERMISSIONS.SETTINGS_READ] },
    ],
  },
];

/**
 * Routes that are a navigation root — no back chevron in the title bar.
 * Includes the debts sub-tabs: they are reached by tapping a tab inside
 * DebtsLayout, not by drilling down, so there is nothing above them.
 */
export const ROOT_PATHS = new Set([
  '/',
  '/operations',
  '/debts',
  '/debts/receivables',
  '/debts/payables',
  '/more',
]);

export function isVisible(entry: NavEntry, has: (code: PermissionCode) => boolean): boolean {
  return entry.anyOf.length === 0 || entry.anyOf.some(has);
}
