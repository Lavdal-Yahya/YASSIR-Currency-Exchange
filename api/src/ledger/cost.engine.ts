import { Injectable } from '@nestjs/common';
import { Prisma, type CurrencyLedger } from '@prisma/client';
import { Decimal } from '../common/money.js';
import { LedgerContractError } from '../common/errors/ledger.errors.js';
import type { Tx } from './ledger.types.js';

// CostEngine — the weighted-average-cost book.
//
// Applied once per ledger entry inside the same tx that LedgerService
// wrote it. Two operations only:
//
//   apply(tx, entry, ctx)     — during LedgerService.apply
//   replay(tx, currencyId)    — recompute the cost cache from active
//                               cost_movement rows. Used by trade
//                               reversal in P6-04 (D-021). Idempotent.
//
// Rules (D-005 + D-006 + D-008):
//   1. The base currency (MRU) is skipped entirely — its unit cost is a
//      fixed 1.00, it never registers realized P&L, and no
//      cost_movement rows are written for it. (Schema review §2.4
//      final paragraph, D-006.)
//   2. Non-base ACQUISITION (CREDIT): quantity added at the caller's
//      unitCostMru. The new WAC is `(old_qty·old_avg + qty·unit_cost) /
//      (old_qty + qty)`. Caller-supplied unit cost is required — the
//      engine has no way to invent it.
//   3. Non-base DISPOSAL (DEBIT): quantity subtracted at the current
//      WAC. Realized P&L is `disposalValueMru − qty·wac`. When the
//      caller omits `disposalValueMru`, the disposal is booked at cost
//      (realized P&L = 0). WAC itself is unchanged by a disposal.
//   4. Ordering is by ledger.sequence, never by transaction_date. A
//      backdated purchase entered today affects the average from today
//      forward, not retroactively (D-008).
//
// Nothing else writes to cost_movement or currency_cost. Grep in DoD.

export interface CostContext {
  baseCurrencyId: string;
  /** Required for non-base ACQUISITIONs. Ignored otherwise. */
  unitCostMru?: Decimal | string;
  /**
   * Optional for non-base DISPOSALs. When present, realized P&L is
   * computed against it. When absent, disposal is booked at cost —
   * useful for tests that only care about quantity/WAC bookkeeping,
   * and for the "no gain, no loss" MRU disposals from P5.
   */
  disposalValueMru?: Decimal | string;
}

interface CostCache {
  cachedAvgMru: Decimal;
  cachedQuantity: Decimal;
}

const ONE = new Decimal(1);
const ZERO = new Decimal(0);

@Injectable()
export class CostEngine {
  async apply(tx: Tx, entry: CurrencyLedger, ctx: CostContext): Promise<void> {
    // Rule 1 — MRU is a measurement unit, not a tradable position.
    if (entry.currencyId === ctx.baseCurrencyId) return;

    const qty = new Decimal(entry.amount.toString());
    const cache = await this.loadCache(tx, entry.currencyId);

    if (entry.direction === 'CREDIT') {
      // ACQUISITION.
      if (ctx.unitCostMru === undefined) {
        throw new LedgerContractError('unitCostMru is required for a non-base acquisition', {
          currencyId: entry.currencyId,
          ledgerEntryId: entry.id.toString(),
        });
      }
      const unitCost = toDecimal(ctx.unitCostMru);
      if (unitCost.lte(0)) {
        throw new LedgerContractError('unitCostMru must be > 0', {
          unitCostMru: unitCost.toString(),
        });
      }
      const newQty = cache.cachedQuantity.plus(qty);
      // WAC guard against divide-by-zero: newQty is qty + old, both
      // non-negative and qty > 0 (ledger CHECK), so newQty > 0.
      const numerator = cache.cachedQuantity.times(cache.cachedAvgMru).plus(qty.times(unitCost));
      const newAvg = numerator.div(newQty);

      await tx.costMovement.create({
        data: {
          currencyId: entry.currencyId,
          ledgerEntryId: entry.id,
          kind: 'ACQUISITION',
          quantity: new Prisma.Decimal(qty.toString()),
          unitCostMru: new Prisma.Decimal(unitCost.toString()),
          realizedPnlMru: null,
          sequence: entry.sequence,
        },
      });
      await this.upsertCache(tx, entry.currencyId, {
        cachedAvgMru: newAvg,
        cachedQuantity: newQty,
      });
      return;
    }

    // DEBIT → DISPOSAL.
    const disposalUnitCost = cache.cachedAvgMru;
    const realized =
      ctx.disposalValueMru !== undefined
        ? toDecimal(ctx.disposalValueMru).minus(qty.times(disposalUnitCost))
        : ZERO;
    const newQty = cache.cachedQuantity.minus(qty);
    // The trigger on currency_cost refuses newQty < 0 for non-base — an
    // upstream contract bug hits the trigger, not silent data.
    await tx.costMovement.create({
      data: {
        currencyId: entry.currencyId,
        ledgerEntryId: entry.id,
        kind: 'DISPOSAL',
        quantity: new Prisma.Decimal(qty.toString()),
        unitCostMru: new Prisma.Decimal(
          // Guard against divide-by-zero on the first-ever movement (shouldn't
          // happen — you can't dispose what you don't have — but the DB trigger
          // is what enforces that; keep the cost row honest either way).
          disposalUnitCost.eq(0) ? '0.00000001' : disposalUnitCost.toString(),
        ),
        realizedPnlMru: new Prisma.Decimal(realized.toString()),
        sequence: entry.sequence,
      },
    });
    // WAC unchanged; only quantity drops. WAC becomes 0 when quantity
    // reaches 0 — a clean-slate reset for the next acquisition.
    const newAvg = newQty.eq(0) ? ZERO : cache.cachedAvgMru;
    await this.upsertCache(tx, entry.currencyId, { cachedAvgMru: newAvg, cachedQuantity: newQty });
  }

  /**
   * Recompute currency_cost from active cost_movement rows for a single
   * currency. Idempotent — running twice produces the same result as
   * running once. Used by trade reversal (P6-04, D-021).
   *
   * Reads cost_movement in ledger sequence order (D-008). Inactive rows
   * (`is_active = false`) are ignored.
   */
  async replay(tx: Tx, currencyId: string): Promise<void> {
    const settings = await tx.settings.findUniqueOrThrow({ where: { id: 1 } });
    if (currencyId === settings.baseCurrencyId) return; // rule 1

    const movements = await tx.costMovement.findMany({
      where: { currencyId, isActive: true },
      orderBy: { sequence: 'asc' },
    });

    let avg = ZERO;
    let qty = ZERO;
    for (const m of movements) {
      const mQty = new Decimal(m.quantity.toString());
      const mUnitCost = new Decimal(m.unitCostMru.toString());
      if (m.kind === 'ACQUISITION') {
        const newQty = qty.plus(mQty);
        avg = newQty.eq(0) ? ZERO : qty.times(avg).plus(mQty.times(mUnitCost)).div(newQty);
        qty = newQty;
      } else {
        qty = qty.minus(mQty);
        if (qty.eq(0)) avg = ZERO;
        // WAC unchanged otherwise — realized P&L is bookkeeping, not
        // cost-basis adjustment.
      }
    }

    await this.upsertCache(tx, currencyId, { cachedAvgMru: avg, cachedQuantity: qty });
  }

  private async loadCache(tx: Tx, currencyId: string): Promise<CostCache> {
    const row = await tx.currencyCost.findUnique({ where: { currencyId } });
    if (!row) return { cachedAvgMru: ZERO, cachedQuantity: ZERO };
    return {
      cachedAvgMru: new Decimal(row.cachedAvgMru.toString()),
      cachedQuantity: new Decimal(row.cachedQuantity.toString()),
    };
  }

  private async upsertCache(
    tx: Tx,
    currencyId: string,
    values: { cachedAvgMru: Decimal; cachedQuantity: Decimal },
  ): Promise<void> {
    // The DB trigger check_currency_cost_nonneg refuses cachedQuantity
    // < 0 on non-base — that's our independent last line of defence
    // when the service logic drifts.
    await tx.currencyCost.upsert({
      where: { currencyId },
      create: {
        currencyId,
        cachedAvgMru: new Prisma.Decimal(values.cachedAvgMru.toString()),
        cachedQuantity: new Prisma.Decimal(values.cachedQuantity.toString()),
      },
      update: {
        cachedAvgMru: new Prisma.Decimal(values.cachedAvgMru.toString()),
        cachedQuantity: new Prisma.Decimal(values.cachedQuantity.toString()),
      },
    });
  }
}

// Silence Decimal type-narrowing when caller passes a number that
// slipped through: we still want the D-002 guard to bite loudly.
function toDecimal(v: Decimal | string): Decimal {
  if (v instanceof Decimal) return v;
  if (typeof v === 'number') {
    throw new TypeError('cost engine received a JavaScript number (D-002)');
  }
  return new Decimal(v);
}
// Silence the unused-import warning while keeping ONE available for
// callers reading this file next to §2 of the schema review.
void ONE;
