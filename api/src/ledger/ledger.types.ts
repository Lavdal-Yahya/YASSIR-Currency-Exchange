import type { CurrencyLedger, LedgerDirection, Prisma } from '@prisma/client';
import type { Decimal } from 'decimal.js';

// A single movement to apply. LedgerService.apply is a batch API — one
// business operation, N movements, one transaction. A single movement
// is `apply(tx, [m])`; there is no non-batch entry point.
//
// The transaction client (`tx`) is the first parameter of the service
// method, not part of Movement — one operation, one transaction, many
// movements. Architecture §3.3.
export interface Movement {
  currencyId: string;
  direction: LedgerDirection;
  /** Positive magnitude. Direction carries sign. */
  amount: Decimal | string;
  /**
   * Discriminator for the source row: 'opening_balance' | 'purchase' |
   * 'sale' | 'payment' | 'expense'. Free-form to keep the ledger a
   * general primitive; the service layer enforces the set per phase.
   */
  sourceType: string;
  /**
   * Nullable only when sourceType='opening_balance'. Every other
   * source_type points at its row. Enforced in the database by
   * currency_ledger_source_link_check.
   */
  sourceId?: string | null;
  paymentMethodId?: string | null;
  /**
   * Required when the payment method's requires_note flag is true.
   * D-020. Enforced in apply().
   */
  note?: string | null;
  transactionDate: Date;
  /** Human string, i18n-neutral (English internal). */
  description: string;
  createdByUserId: string;
  /**
   * Required when direction=CREDIT on a non-base currency (the movement
   * is an ACQUISITION and CostEngine needs the MRU value per unit).
   * For an opening this is the operator-supplied
   * `opening_avg_cost_mru`; for a trade's non-base leg this is
   * `paymentMru / deliveredQty`. Ignored for base-currency movements
   * (MRU unit cost is fixed at 1.00, D-006) and for DEBITs (CostEngine
   * uses the current weighted-average).
   */
  unitCostMru?: Decimal | string;
  /**
   * Optional for non-base DISPOSALs (DEBIT on a non-base currency). The
   * MRU value the counterparty gave us for what we disposed of, used to
   * compute `realized_pnl_mru = disposalValueMru − (qty × cachedAvg)`.
   * For a sale of USD for MRU, this is the MRU credit from the same
   * batch. For a supplier payment in USD, this is the MRU value implied
   * by the payable at its creation (D-017), looked up by the payment
   * service. When omitted the disposal is booked at cost — realized P&L
   * is 0.
   */
  disposalValueMru?: Decimal | string;
}

/**
 * Owner-only negative-balance override, per D-015. When present and
 * valid, allows the batch to leave the base currency's balance below
 * zero. Refused entirely for non-base currencies — a negative quantity
 * has no meaningful weighted-average cost. Audit-logged either way.
 */
export interface NegativeBalanceOverride {
  /** Free-text reason from the operator. Non-empty required. */
  reason: string;
  /**
   * Whether the actor holds the `balance:override` permission. The
   * controller establishes this from the request; the service does not
   * introspect the user directly.
   */
  actorHasPermission: boolean;
}

export interface ApplyOptions {
  negativeBalanceOverride?: NegativeBalanceOverride;
  /**
   * Optional caller identifier for the override audit row. Falls back
   * to Movement.createdByUserId when omitted.
   */
  actorUserId?: string;
  ip?: string | null;
}

export type LedgerEntry = CurrencyLedger;

/** Handy re-export so services don't import from '@prisma/client' just for the tx type. */
export type Tx = Prisma.TransactionClient;
