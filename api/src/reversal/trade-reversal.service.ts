import { Injectable } from '@nestjs/common';
import type { Prisma, Purchase, Sale } from '@prisma/client';
import { AuditService } from '../audit/audit.service.js';
import { Decimal, roundTo } from '../common/money.js';
import { PrismaService } from '../common/prisma.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import type { Tx } from '../ledger/ledger.types.js';
import {
  AlreadyReversedError,
  ReversalReasonRequiredError,
  ReversalTargetNotFoundError,
} from './errors.js';

// TradeReversalService — P6-04, D-021 (recompute-and-restate).
//
// The most consequential reversal in the system. Reversing a purchase
// that added stock, some of which was later sold, forces every downstream
// sale's `gross_profit_mru` and `cost_of_currency_sold_mru` to be
// **rewritten** to reflect the WAC book that would have existed had the
// reversed purchase never happened. Reports the operator printed last
// week can show different numbers next week.
//
// The rewrite is *not* a delta patch — it's a full replay:
//   1. LedgerService.deactivateBySource(sourceType, tradeId) flips the
//      trade's ledger + cost movement rows to is_active=false, rolls the
//      balance cache back, and calls CostEngine.replay for every currency
//      the trade touched. WAC is now what it would have been.
//   2. For every SALE whose delivered-currency WAC was affected, we
//      re-derive `cost_of_currency_sold_mru` and `gross_profit_mru`
//      using the *current* replayed WAC.
//
// This is per-sale, forward-only. A sale that came before the reversed
// trade in ledger sequence order is unaffected (its WAC was already
// correct); a sale that came after may see its profit change.
//
// The API response includes the count and IDs of restated sales so the
// frontend can warn the operator ("This reversal restated N prior sales'
// profit") *at the moment of confirmation* — phase-6.md §5, D-021 point 2.
//
// Trade rows carry a receivable (sale) or payable (purchase) when they
// were partially/unpaid. Reversing a trade must also flip that debt to
// REVERSED and re-recompute — its allocations' liveness cascades via
// D-011 (the target is now inactive).

export interface TradeReversalResult {
  tradeId: string;
  tradeKind: 'purchase' | 'sale';
  restatedSaleIds: string[];
}

@Injectable()
export class TradeReversalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  async reversePurchase(
    purchaseId: string,
    actorId: string,
    reason: string,
    ip: string | null,
  ): Promise<TradeReversalResult> {
    const trimmedReason = reason.trim();
    if (trimmedReason === '') {
      throw new ReversalReasonRequiredError({ entityType: 'purchase', entityId: purchaseId });
    }

    return this.prisma.$transaction(async (tx) => {
      const purchase = await tx.purchase.findUnique({ where: { id: purchaseId } });
      if (!purchase) {
        throw new ReversalTargetNotFoundError({ entityType: 'purchase', entityId: purchaseId });
      }
      if (purchase.status === 'REVERSED') {
        throw new AlreadyReversedError({ entityType: 'purchase', entityId: purchaseId });
      }

      const now = new Date();
      await tx.purchase.update({
        where: { id: purchaseId },
        data: {
          status: 'REVERSED',
          reversalReason: trimmedReason,
          reversedByUserId: actorId,
          reversedAt: now,
        },
      });

      const { affectedCurrencyIds } = await this.ledger.deactivateBySource(
        tx,
        'purchase',
        purchaseId,
      );

      // Reverse the payable this purchase created (if any). All its
      // allocations lose liveness (target inactive → D-011 excludes them);
      // reversing the payments is a separate action the operator takes
      // if they want, but the debt itself becomes REVERSED here.
      await this.reverseAssociatedDebt(tx, 'payable', 'purchase', purchaseId);

      // Restate every downstream sale that used a WAC we just changed.
      const restatedSaleIds = await this.restateDownstreamSales(tx, affectedCurrencyIds);

      await this.audit.log(tx, {
        action: 'purchase_reversed',
        actorUserId: actorId,
        entityType: 'purchase',
        entityId: purchaseId,
        reason: trimmedReason,
        before: this.tradeSnapshot(purchase),
        after: {
          status: 'REVERSED',
          reversedAt: now.toISOString(),
          reversedByUserId: actorId,
          restatedSaleIds,
        },
        ip,
      });

      return { tradeId: purchaseId, tradeKind: 'purchase', restatedSaleIds };
    });
  }

  async reverseSale(
    saleId: string,
    actorId: string,
    reason: string,
    ip: string | null,
  ): Promise<TradeReversalResult> {
    const trimmedReason = reason.trim();
    if (trimmedReason === '') {
      throw new ReversalReasonRequiredError({ entityType: 'sale', entityId: saleId });
    }

    return this.prisma.$transaction(async (tx) => {
      const sale = await tx.sale.findUnique({ where: { id: saleId } });
      if (!sale) {
        throw new ReversalTargetNotFoundError({ entityType: 'sale', entityId: saleId });
      }
      if (sale.status === 'REVERSED') {
        throw new AlreadyReversedError({ entityType: 'sale', entityId: saleId });
      }

      const now = new Date();
      await tx.sale.update({
        where: { id: saleId },
        data: {
          status: 'REVERSED',
          reversalReason: trimmedReason,
          reversedByUserId: actorId,
          reversedAt: now,
          // The reversed sale contributes nothing to any report — zero
          // out its profit snapshot so aggregations that (wrongly)
          // include REVERSED rows still return 0 from this row.
          costOfCurrencySoldMru: '0',
          grossProfitMru: '0',
        },
      });

      const { affectedCurrencyIds } = await this.ledger.deactivateBySource(tx, 'sale', saleId);

      // Reverse the receivable this sale created (if any).
      await this.reverseAssociatedDebt(tx, 'receivable', 'sale', saleId);

      // A sale's own cost DISPOSAL leaves WAC unchanged (D-005 rule 3),
      // so removing it usually doesn't restate downstream sales. But if
      // the sale we're reversing happened to be the ONE that dropped
      // qty to zero (and thus reset WAC to zero — CostEngine.apply rule
      // 3 tail), then a downstream ACQUISITION may have started from
      // that zero. `restateDownstreamSales` covers the general case; if
      // there's nothing to restate it returns an empty list.
      const restatedSaleIds = await this.restateDownstreamSales(tx, affectedCurrencyIds);

      await this.audit.log(tx, {
        action: 'sale_reversed',
        actorUserId: actorId,
        entityType: 'sale',
        entityId: saleId,
        reason: trimmedReason,
        before: this.tradeSnapshot(sale),
        after: {
          status: 'REVERSED',
          reversedAt: now.toISOString(),
          reversedByUserId: actorId,
          restatedSaleIds,
        },
        ip,
      });

      return { tradeId: saleId, tradeKind: 'sale', restatedSaleIds };
    });
  }

  // Reversal of the receivable/payable associated with a trade. The
  // debt's payment allocations get their liveness stripped automatically
  // (D-011: target inactive → excluded from recompute sum). We flip the
  // debt to REVERSED and zero its outstanding.
  private async reverseAssociatedDebt(
    tx: Tx,
    debtKind: 'receivable' | 'payable',
    sourceType: 'purchase' | 'sale',
    sourceId: string,
  ): Promise<void> {
    if (debtKind === 'receivable') {
      const rec = await tx.receivable.findFirst({ where: { sourceType, sourceId } });
      if (!rec || rec.status === 'REVERSED') return;
      await tx.receivable.update({
        where: { id: rec.id },
        data: {
          status: 'REVERSED',
          // outstanding_amount left as-is for history; readers filter
          // on status = 'REVERSED' to exclude. INV-2/3 skip REVERSED rows.
        },
      });
      return;
    }
    const pay = await tx.payable.findFirst({ where: { sourceType, sourceId } });
    if (!pay || pay.status === 'REVERSED') return;
    await tx.payable.update({
      where: { id: pay.id },
      data: { status: 'REVERSED' },
    });
  }

  // Restate downstream sales after CostEngine.replay changed the WAC
  // for some non-base currencies. For each affected currency, re-read
  // every CONFIRMED sale whose delivered_currency is that currency and
  // re-derive its profit against the current WAC.
  //
  // "Downstream" is implicit: a sale that came before the reversed trade
  // in ledger sequence order sees no WAC change on replay (its cost
  // movements are all before the reversed one), so recomputing its
  // profit yields the same value and the update is a no-op. We do it
  // uniformly rather than trying to slice the ledger — simpler and
  // idempotent.
  //
  // Only sales where delivered is non-base can restate: MRU sales have
  // gross_profit = 0 by construction (D-006).
  private async restateDownstreamSales(tx: Tx, affectedCurrencyIds: string[]): Promise<string[]> {
    if (affectedCurrencyIds.length === 0) return [];

    const settings = await tx.settings.findUniqueOrThrow({ where: { id: 1 } });
    const baseCurrency = await tx.currency.findUniqueOrThrow({
      where: { id: settings.baseCurrencyId },
    });

    // For each affected non-base currency, compute the WAC series by
    // ledger sequence — the value of the WAC at the moment each
    // downstream sale disposed. The current cached WAC is the *end*
    // of the series; we need the value at each sale's own sequence
    // point. So instead of computing from cache, replay per sale.
    const restatedIds: string[] = [];

    for (const currencyId of affectedCurrencyIds) {
      if (currencyId === settings.baseCurrencyId) continue; // MRU: nothing to restate

      // All confirmed sales whose delivered currency is this one, in
      // ledger sequence order (via the sale's own DEBIT cost movement).
      const sales = await tx.$queryRaw<
        {
          sale_id: string;
          delivered_amount: string;
          payment_total: string;
          sequence: string;
          cost_of_currency_sold_mru: string;
          gross_profit_mru: string;
        }[]
      >`
        SELECT
          s."id" AS sale_id,
          s."delivered_amount"::text AS delivered_amount,
          s."payment_total"::text AS payment_total,
          cm."sequence"::text AS sequence,
          s."cost_of_currency_sold_mru"::text AS cost_of_currency_sold_mru,
          s."gross_profit_mru"::text AS gross_profit_mru
        FROM "sale" s
        JOIN "currency_ledger" cl
          ON cl."source_type" = 'sale'
         AND cl."source_id" = s."id"
         AND cl."currency_id" = s."delivered_currency_id"
         AND cl."direction" = 'DEBIT'
         AND cl."is_active" = true
        JOIN "cost_movement" cm ON cm."ledger_entry_id" = cl."id"
        WHERE s."status" = 'CONFIRMED'
          AND s."delivered_currency_id" = ${currencyId}::uuid
        ORDER BY cm."sequence" ASC
      `;

      // Replay the WAC ourselves, marking each sale's expected
      // cost_of_currency_sold_mru at its own disposal point.
      // The WAC at sequence S is derived by scanning all active
      // cost_movement rows with sequence < S; but that would be N
      // queries. Faster: single-pass over the entire cost_movement
      // history of this currency (ordered by sequence) and record
      // the running WAC before each sale-sourced DISPOSAL.
      const movements = await tx.$queryRaw<
        {
          kind: string;
          quantity: string;
          unit_cost_mru: string;
          sequence: string;
          ledger_entry_id: string;
          sale_id: string | null;
        }[]
      >`
        SELECT
          cm."kind"::text AS kind,
          cm."quantity"::text AS quantity,
          cm."unit_cost_mru"::text AS unit_cost_mru,
          cm."sequence"::text AS sequence,
          cm."ledger_entry_id"::text AS ledger_entry_id,
          (
            SELECT cl2."source_id"
            FROM "currency_ledger" cl2
            WHERE cl2."id" = cm."ledger_entry_id"
              AND cl2."source_type" = 'sale'
              AND cl2."direction" = 'DEBIT'
          ) AS sale_id
        FROM "cost_movement" cm
        WHERE cm."currency_id" = ${currencyId}::uuid
          AND cm."is_active" = true
        ORDER BY cm."sequence" ASC
      `;

      let avg = new Decimal(0);
      let qty = new Decimal(0);
      const wacAtSale = new Map<string, Decimal>();
      for (const m of movements) {
        const mQty = new Decimal(m.quantity);
        const mUnit = new Decimal(m.unit_cost_mru);
        if (m.kind === 'ACQUISITION') {
          const newQty = qty.plus(mQty);
          avg = newQty.eq(0) ? new Decimal(0) : qty.times(avg).plus(mQty.times(mUnit)).div(newQty);
          qty = newQty;
        } else {
          // Record WAC at the moment of this sale's disposal *before*
          // updating qty (per D-005 rule 3 — WAC unchanged by disposal
          // except when qty reaches zero, in which case avg resets AFTER).
          if (m.sale_id) {
            wacAtSale.set(m.sale_id, avg);
          }
          qty = qty.minus(mQty);
          if (qty.eq(0)) avg = new Decimal(0);
        }
      }

      for (const s of sales) {
        const wac = wacAtSale.get(s.sale_id);
        if (!wac) continue; // sale's DEBIT was inactive — its own reversal
        const delivered = new Decimal(s.delivered_amount);
        const paymentTotal = new Decimal(s.payment_total);
        const expectedCost = roundTo(delivered.times(wac), baseCurrency.decimalPlaces);
        const expectedProfit = paymentTotal.minus(expectedCost);
        const storedCost = new Decimal(s.cost_of_currency_sold_mru);
        const storedProfit = new Decimal(s.gross_profit_mru);
        if (!expectedCost.eq(storedCost) || !expectedProfit.eq(storedProfit)) {
          await tx.sale.update({
            where: { id: s.sale_id },
            data: {
              costOfCurrencySoldMru: expectedCost.toString(),
              grossProfitMru: expectedProfit.toString(),
            },
          });
          restatedIds.push(s.sale_id);
        }
      }
    }

    return restatedIds;
  }

  private tradeSnapshot(t: Purchase | Sale): Prisma.InputJsonValue {
    return {
      status: t.status,
      paymentStatus: t.paymentStatus,
      deliveredCurrencyId: t.deliveredCurrencyId,
      deliveredAmount: t.deliveredAmount.toString(),
      paymentCurrencyId: t.paymentCurrencyId,
      paymentTotal: t.paymentTotal.toString(),
      rate: t.rate.toString(),
    };
  }
}
