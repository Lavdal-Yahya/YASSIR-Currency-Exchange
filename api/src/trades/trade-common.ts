import { createHash } from 'node:crypto';
import type { Currency, Sale, TradePaymentStatus } from '@prisma/client';
import { Decimal, roundTo } from '../common/money.js';
import type { Movement } from '../ledger/ledger.types.js';
import { NoBaseCurrencyLegError, RateTotalMismatchError } from './errors.js';

// Shared helpers between PurchaseService and SaleService.
//
// The two services split at "which side is CREDIT and which is DEBIT",
// but every other primitive — base-leg rule (D-019), rate/total
// derivation (D-009 + D-024), Movement construction, WAC math — is the
// same for both. Keeping the primitives here means the two services
// stay small and the base-leg / rate-total invariants have one place to
// live.

export type TradeKind = 'purchase' | 'sale';
export type BaseSide = 'delivered' | 'payment';

// ---------------------------------------------------------------------------
// D-019 base-leg rule
// ---------------------------------------------------------------------------

/**
 * Reject a trade whose two legs are both base or both non-base. Returns
 * which side is the base leg — needed downstream to build the correct
 * CREDIT/DEBIT direction on each movement.
 */
export function resolveBaseSide(
  deliveredCurrency: Pick<Currency, 'id' | 'code'>,
  paymentCurrency: Pick<Currency, 'id' | 'code'>,
  baseCurrencyId: string,
  baseCurrencyCode: string,
): BaseSide {
  const deliveredIsBase = deliveredCurrency.id === baseCurrencyId;
  const paymentIsBase = paymentCurrency.id === baseCurrencyId;

  if (deliveredIsBase && paymentIsBase) {
    // Same currency both legs is impossible (DB CHECK), so both-base
    // implies delivered_currency_id = payment_currency_id which is
    // already rejected earlier — but keep the branch for symmetry.
    throw new NoBaseCurrencyLegError({
      deliveredCurrencyCode: deliveredCurrency.code,
      paymentCurrencyCode: paymentCurrency.code,
      baseCurrencyCode,
      reason: 'both_base',
    });
  }
  if (!deliveredIsBase && !paymentIsBase) {
    throw new NoBaseCurrencyLegError({
      deliveredCurrencyCode: deliveredCurrency.code,
      paymentCurrencyCode: paymentCurrency.code,
      baseCurrencyCode,
      reason: 'neither_base',
    });
  }
  return deliveredIsBase ? 'delivered' : 'payment';
}

// ---------------------------------------------------------------------------
// D-009 + D-023 item 4 + D-024 · rate/total derivation & strict equality
// ---------------------------------------------------------------------------

export interface RateTotalInput {
  /** Always required — the amount the operator entered on the delivered side. */
  deliveredAmount: Decimal;
  /** At least one of rate or paymentTotal must be present. */
  rate?: Decimal;
  paymentTotal?: Decimal;
}

export interface DerivedRateTotal {
  rate: Decimal;
  paymentTotal: Decimal;
}

/**
 * Derive whichever of rate / paymentTotal the operator omitted, then
 * verify the strict-equality constraint `paymentTotal = deliveredAmount
 * × rate` at NUMERIC precision. Throws RateTotalMismatchError with the
 * numbers on either side of the difference when it fails.
 *
 * D-024 documents the trade-off: the frontend always rounds one side
 * so the product is exact at the payment currency's dp. An input that
 * doesn't multiply out cleanly is refused here (422) rather than at the
 * DB CHECK (500 masquerade).
 */
export function deriveRateAndTotal(
  input: RateTotalInput,
  paymentCurrencyDp: number,
  paymentCurrencyCode: string,
): DerivedRateTotal {
  if (input.rate === undefined && input.paymentTotal === undefined) {
    // Caller (DTO validator) should have caught this — belt-and-braces.
    throw new RateTotalMismatchError({
      deliveredAmount: input.deliveredAmount.toString(),
      rate: '?',
      providedTotal: '?',
      expectedTotal: '?',
      paymentCurrencyCode,
    });
  }

  let rate: Decimal;
  let paymentTotal: Decimal;

  if (input.rate !== undefined && input.paymentTotal !== undefined) {
    rate = input.rate;
    paymentTotal = input.paymentTotal;
  } else if (input.rate !== undefined) {
    rate = input.rate;
    // Derive total, rounded to payment currency dp (D-009).
    paymentTotal = roundTo(input.deliveredAmount.times(rate), paymentCurrencyDp);
  } else {
    // Only paymentTotal is present — the DTO validator upstream rejects
    // "neither rate nor total", so this branch always sees a total.
    if (input.paymentTotal === undefined) {
      throw new Error('unreachable: neither rate nor paymentTotal supplied');
    }
    paymentTotal = roundTo(input.paymentTotal, paymentCurrencyDp);
    // Derive rate at full 8dp precision (rate schema is NUMERIC(24,8)).
    rate = paymentTotal.div(input.deliveredAmount).toDecimalPlaces(8, Decimal.ROUND_HALF_UP);
  }

  // Strict-equality guard. delivered × rate MUST equal paymentTotal
  // exactly at NUMERIC precision. Any residual triggers 422.
  const expected = input.deliveredAmount.times(rate);
  if (!expected.eq(paymentTotal)) {
    throw new RateTotalMismatchError({
      deliveredAmount: input.deliveredAmount.toString(),
      rate: rate.toString(),
      providedTotal: paymentTotal.toString(),
      expectedTotal: expected.toString(),
      paymentCurrencyCode,
    });
  }

  return { rate, paymentTotal };
}

// ---------------------------------------------------------------------------
// Payment status from immediate vs total (D-013)
// ---------------------------------------------------------------------------

export function computePaymentStatus(immediate: Decimal, total: Decimal): TradePaymentStatus {
  if (immediate.eq(0)) return 'UNPAID';
  if (immediate.eq(total)) return 'PAID';
  return 'PARTIALLY_PAID';
}

// ---------------------------------------------------------------------------
// Movement construction — the shape LedgerService.apply consumes
// ---------------------------------------------------------------------------

export interface TradeContext {
  kind: TradeKind;
  tradeId: string;
  /** delivered_currency full amount. */
  deliveredAmount: Decimal;
  deliveredCurrencyId: string;
  /** payment_currency total amount (the whole deal). */
  paymentTotal: Decimal;
  paymentCurrencyId: string;
  /** actual immediate payment moved right now, ≤ paymentTotal. */
  immediatePayment: Decimal;
  baseSide: BaseSide;
  baseCurrencyId: string;
  /** Decimal places for the base currency (needed to round MRU values). */
  baseCurrencyDp: number;
  paymentMethodId: string | null;
  paymentMethodNote: string | null;
  transactionDate: Date;
  createdByUserId: string;
}

/**
 * Build the Movement[] a trade hands to LedgerService.apply.
 *
 * Direction convention:
 *   purchase → delivered=CREDIT (bureau receives), payment=DEBIT (bureau pays)
 *   sale     → delivered=DEBIT  (bureau gives),    payment=CREDIT (bureau receives)
 *
 * The delivered leg is always the full amount; the payment leg carries
 * `immediatePayment` (may be 0 → the leg is skipped). The immediate
 * payment leg carries the payment_method; the delivered leg never does
 * (architecture §3.6 last paragraph).
 *
 * Cost params on the non-base leg (unitCostMru for a CREDIT
 * ACQUISITION, disposalValueMru for a DEBIT DISPOSAL) are computed
 * from the *actual* leg amount vs its proportional MRU value:
 *
 *   non-base = delivered (leg is full):
 *     mruValue = paymentTotal  (the base leg's full amount)
 *
 *   non-base = payment (leg is immediatePayment):
 *     mruValue = deliveredAmount × immediatePayment / paymentTotal
 *                (base leg's amount × proportion of payment moved)
 *
 * For CREDIT: unitCostMru = mruValue / legAmount.
 * For DEBIT:  disposalValueMru = mruValue directly.
 *
 * Sale's delivered-side DISPOSAL is a special case: profit is
 * recognized at confirmation regardless of collection (spec §19.5), so
 * disposalValueMru = paymentTotal (full sale value), not proportional.
 * Which is what the "non-base = delivered" branch above already gives
 * us. Consistency by construction.
 */
export function buildTradeMovements(ctx: TradeContext): Movement[] {
  const isPurchase = ctx.kind === 'purchase';
  const deliveredDirection: 'CREDIT' | 'DEBIT' = isPurchase ? 'CREDIT' : 'DEBIT';
  const paymentDirection: 'CREDIT' | 'DEBIT' = isPurchase ? 'DEBIT' : 'CREDIT';

  // Cost params for whichever leg is non-base.
  const deliveredIsBase = ctx.baseSide === 'delivered';
  const paymentIsBase = ctx.baseSide === 'payment';

  const movements: Movement[] = [];

  // ---------- Delivered leg (always full amount) ----------------------
  {
    let unitCostMru: Decimal | undefined;
    let disposalValueMru: Decimal | undefined;

    if (!deliveredIsBase) {
      // Non-base delivered. Its MRU value = paymentTotal (base leg's full).
      const mruValue = ctx.paymentTotal;
      if (deliveredDirection === 'CREDIT') {
        // Purchase acquiring non-base. unitCost = mruValue / qty = rate.
        // Round to 8dp — the DB column is NUMERIC(24,8), and predictable
        // rounding beats implicit truncation.
        unitCostMru = mruValue.div(ctx.deliveredAmount).toDecimalPlaces(8, Decimal.ROUND_HALF_UP);
      } else {
        // Sale disposing non-base. Profit is recognized on full sale
        // value at confirmation, not proportional to immediate payment.
        disposalValueMru = mruValue;
      }
    }

    movements.push({
      currencyId: ctx.deliveredCurrencyId,
      direction: deliveredDirection,
      amount: ctx.deliveredAmount,
      sourceType: ctx.kind,
      sourceId: ctx.tradeId,
      paymentMethodId: null, // delivered leg never carries a method (D-020, arch §3.6)
      note: null,
      transactionDate: ctx.transactionDate,
      description: `${ctx.kind} ${ctx.tradeId} — delivered`,
      createdByUserId: ctx.createdByUserId,
      ...(unitCostMru !== undefined && { unitCostMru }),
      ...(disposalValueMru !== undefined && { disposalValueMru }),
    });
  }

  // ---------- Payment leg (only if immediatePayment > 0) --------------
  if (ctx.immediatePayment.gt(0)) {
    let unitCostMru: Decimal | undefined;
    let disposalValueMru: Decimal | undefined;

    if (!paymentIsBase) {
      // Non-base payment. Its MRU value is proportional to how much of
      // the payment total we actually moved this instant.
      const mruValue = roundTo(
        ctx.deliveredAmount.times(ctx.immediatePayment).div(ctx.paymentTotal),
        ctx.baseCurrencyDp,
      );
      if (paymentDirection === 'CREDIT') {
        // Sale acquiring non-base as counterparty's payment. Round to
        // 8dp for the same reason as the delivered branch.
        unitCostMru = mruValue.div(ctx.immediatePayment).toDecimalPlaces(8, Decimal.ROUND_HALF_UP);
      } else {
        // Purchase disposing non-base as our payment.
        disposalValueMru = mruValue;
      }
    }

    movements.push({
      currencyId: ctx.paymentCurrencyId,
      direction: paymentDirection,
      amount: ctx.immediatePayment,
      sourceType: ctx.kind,
      sourceId: ctx.tradeId,
      paymentMethodId: ctx.paymentMethodId, // service already validated non-null
      note: ctx.paymentMethodNote,
      transactionDate: ctx.transactionDate,
      description: `${ctx.kind} ${ctx.tradeId} — payment`,
      createdByUserId: ctx.createdByUserId,
      ...(unitCostMru !== undefined && { unitCostMru }),
      ...(disposalValueMru !== undefined && { disposalValueMru }),
    });
  }

  return movements;
}

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

/**
 * Canonicalise-and-hash the request body for idempotency comparison.
 * SHA-256 hex. Keys are sorted so `{a,b}` and `{b,a}` hash identical;
 * numbers stringify with fixed precision so "1" and "1.0" would only
 * be a mismatch if the caller cared. Passed-through: the caller
 * already re-derives rate/total, so the hash is over the raw operator
 * input, not the server-normalised shape — that way "same body"
 * really means "the operator clicked twice", not "some server
 * derivation happened to produce the same trade".
 */
export function hashRequestBody(body: unknown): string {
  const canonical = JSON.stringify(sortKeys(body));
  return createHash('sha256').update(canonical).digest('hex');
}

// ---------------------------------------------------------------------------
// D-018 profit-view stripping (applied in every controller response)
// ---------------------------------------------------------------------------

export type SalePublicRow = Omit<Sale, 'costOfCurrencySoldMru' | 'grossProfitMru'>;
export type SaleResponse = Sale | SalePublicRow;

/**
 * Strip the two profit fields from a sale row when the caller lacks
 * `profit:view`. Applied to ALL sale responses — POST and GET alike —
 * so that the permission is enforced at the serializer, not just the
 * route guard (D-018).
 */
export function mapSaleResponse(sale: Sale, hasProfitView: boolean): SaleResponse {
  if (hasProfitView) return sale;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { costOfCurrencySoldMru, grossProfitMru, ...safe } = sale;
  return safe;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    const out: Record<string, unknown> = {};
    for (const [k, v] of entries) out[k] = sortKeys(v);
    return out;
  }
  return value;
}
