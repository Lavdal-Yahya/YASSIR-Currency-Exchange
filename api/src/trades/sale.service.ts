import { Injectable } from '@nestjs/common';
import { Prisma, type Sale } from '@prisma/client';
import { AuditService } from '../audit/audit.service.js';
import { InactiveCurrencyError } from '../common/errors/ledger.errors.js';
import { Decimal, roundTo } from '../common/money.js';
import { PrismaService } from '../common/prisma.service.js';
import { CurrencyNotFoundError } from '../currencies/errors.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { CreateSaleDto } from './dto/create-sale.dto.js';
import {
  DuplicateSubmissionError,
  PaymentMethodRequiredError,
  TradeMissingContactError,
} from './errors.js';
import {
  buildTradeMovements,
  computePaymentStatus,
  deriveRateAndTotal,
  hashRequestBody,
  resolveBaseSide,
} from './trade-common.js';

// SaleService — bureau gives `delivered_currency`, receives
// `payment_currency`. Mirror of PurchaseService, plus the profit
// snapshot: `cost_of_currency_sold_mru` + `gross_profit_mru` are
// written onto the sale row at confirmation and NEVER updated
// (architecture §3.6, spec §19.5).
//
// Cost snapshot:
//   · delivered is non-base → cost = delivered_amount × cachedAvgMru
//     read from currency_cost AFTER LedgerService.apply (WAC is
//     unchanged by a disposal, so before or after is the same value —
//     "after" is chosen because that's when the row is guaranteed to
//     exist for a currency being disposed for the first time).
//     gross_profit = payment_total − cost.
//   · delivered is base (MRU) → both fields = 0. MRU has fixed unit
//     cost 1 and never registers realized P&L (D-006), so a "sale of
//     MRU" produces no realized profit by construction.

@Injectable()
export class SaleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  async create(actorId: string, dto: CreateSaleDto, ip: string | null): Promise<Sale> {
    const bodyHash = hashRequestBody(dto);

    return this.prisma.$transaction(async (tx) => {
      // --- 1. Idempotency ------------------------------------------------
      if (dto.idempotencyKey) {
        const existing = await tx.sale.findFirst({
          where: { createdByUserId: actorId, idempotencyKey: dto.idempotencyKey },
        });
        if (existing) {
          if (existing.idempotencyBodyHash !== bodyHash) {
            throw new DuplicateSubmissionError({
              idempotencyKey: dto.idempotencyKey,
              existingId: existing.id,
              originalSubmittedAt: existing.createdAt.toISOString(),
            });
          }
          return existing;
        }
      }

      // --- 2. Load context ----------------------------------------------
      const settings = await tx.settings.findUniqueOrThrow({ where: { id: 1 } });
      const baseCurrencyId = settings.baseCurrencyId;

      const [deliveredCurrency, paymentCurrency, baseCurrency] = await Promise.all([
        tx.currency.findUnique({ where: { id: dto.deliveredCurrencyId } }),
        tx.currency.findUnique({ where: { id: dto.paymentCurrencyId } }),
        tx.currency.findUniqueOrThrow({ where: { id: baseCurrencyId } }),
      ]);
      if (!deliveredCurrency) throw new CurrencyNotFoundError(dto.deliveredCurrencyId);
      if (!paymentCurrency) throw new CurrencyNotFoundError(dto.paymentCurrencyId);
      if (!deliveredCurrency.isActive) throw new InactiveCurrencyError(deliveredCurrency.code);
      if (!paymentCurrency.isActive) throw new InactiveCurrencyError(paymentCurrency.code);

      // --- 3. Base-leg rule (D-019) -------------------------------------
      const baseSide = resolveBaseSide(
        deliveredCurrency,
        paymentCurrency,
        baseCurrencyId,
        baseCurrency.code,
      );

      // --- 4. Derive rate + total (D-009 + D-024) -----------------------
      const deliveredAmount = new Decimal(dto.deliveredAmount);
      const { rate, paymentTotal } = deriveRateAndTotal(
        {
          deliveredAmount,
          rate: dto.rate ? new Decimal(dto.rate) : undefined,
          paymentTotal: dto.paymentTotal ? new Decimal(dto.paymentTotal) : undefined,
        },
        paymentCurrency.decimalPlaces,
        paymentCurrency.code,
      );

      const immediatePayment = dto.immediatePayment
        ? new Decimal(dto.immediatePayment)
        : new Decimal(0);
      const outstanding = paymentTotal.minus(immediatePayment);
      const paymentStatus = computePaymentStatus(immediatePayment, paymentTotal);

      // --- 4b. Payment method required when immediate > 0 (D-020) -------
      if (immediatePayment.gt(0) && !dto.paymentMethodId) {
        throw new PaymentMethodRequiredError({
          immediatePayment: immediatePayment.toString(),
          paymentCurrencyCode: paymentCurrency.code,
        });
      }

      // --- 4c. Walk-in trades cannot leave debt --------------------------
      if (!dto.contactId && outstanding.gt(0)) {
        throw new TradeMissingContactError({
          outstandingAmount: outstanding.toString(),
          paymentCurrencyCode: paymentCurrency.code,
        });
      }

      // --- 5. Insert sale row with placeholder profit -------------------
      // We can't compute cost until CostEngine has run for the disposal;
      // snapshot values are updated in step 8. The NOT NULL columns get
      // 0/0 as placeholder — the CHECK sale_cost_of_sold_nonneg permits
      // it; the update below always overwrites within the same tx.
      const transactionDate = dto.transactionDate ? new Date(dto.transactionDate) : new Date();

      const sale = await tx.sale.create({
        data: {
          contactId: dto.contactId ?? null,
          deliveredCurrencyId: dto.deliveredCurrencyId,
          deliveredAmount: new Prisma.Decimal(deliveredAmount.toString()),
          paymentCurrencyId: dto.paymentCurrencyId,
          paymentTotal: new Prisma.Decimal(paymentTotal.toString()),
          rate: new Prisma.Decimal(rate.toString()),
          immediatePayment: new Prisma.Decimal(immediatePayment.toString()),
          outstandingAmount: new Prisma.Decimal(outstanding.toString()),
          paymentStatus,
          paymentMethodId: immediatePayment.gt(0) ? dto.paymentMethodId! : null,
          paymentMethodNote: dto.paymentMethodNote ?? null,
          reference: dto.reference ?? null,
          notes: dto.notes ?? null,
          transactionDate,
          idempotencyKey: dto.idempotencyKey ?? null,
          idempotencyBodyHash: dto.idempotencyKey ? bodyHash : null,
          createdByUserId: actorId,
          costOfCurrencySoldMru: new Prisma.Decimal(0),
          grossProfitMru: new Prisma.Decimal(0),
          recipientName: dto.recipientName ?? null,
          destination: dto.destination ?? null,
        },
      });

      // --- 6. Build movements + apply ledger -----------------------------
      const movements = buildTradeMovements({
        kind: 'sale',
        tradeId: sale.id,
        deliveredAmount,
        deliveredCurrencyId: dto.deliveredCurrencyId,
        paymentTotal,
        paymentCurrencyId: dto.paymentCurrencyId,
        immediatePayment,
        baseSide,
        baseCurrencyId,
        baseCurrencyDp: baseCurrency.decimalPlaces,
        paymentMethodId: immediatePayment.gt(0) ? (dto.paymentMethodId ?? null) : null,
        paymentMethodNote: dto.paymentMethodNote ?? null,
        transactionDate,
        createdByUserId: actorId,
      });

      await this.ledger.apply(tx, movements);

      // --- 7. Receivable if outstanding > 0 ------------------------------
      if (outstanding.gt(0)) {
        await tx.receivable.create({
          data: {
            contactId: dto.contactId!,
            currencyId: dto.paymentCurrencyId,
            originalAmount: new Prisma.Decimal(outstanding.toString()),
            outstandingAmount: new Prisma.Decimal(outstanding.toString()),
            origin: 'TRADE',
            sourceType: 'sale',
            sourceId: sale.id,
          },
        });
      }

      // --- 8. Snapshot cost + profit (spec §19.5, architecture §3.6) ----
      // WAC is unchanged by disposal, so reading after ledger.apply
      // returns the same avg the engine used. When delivered is base,
      // no cost row exists — snapshot 0/0 per D-006.
      let costOfSold = new Decimal(0);
      let grossProfit = new Decimal(0);
      if (baseSide === 'payment') {
        // delivered is non-base — snapshot uses cached WAC.
        const cost = await tx.currencyCost.findUnique({
          where: { currencyId: dto.deliveredCurrencyId },
        });
        const cachedAvg = cost ? new Decimal(cost.cachedAvgMru.toString()) : new Decimal(0);
        costOfSold = roundTo(deliveredAmount.times(cachedAvg), baseCurrency.decimalPlaces);
        grossProfit = paymentTotal.minus(costOfSold);
      }
      const updated = await tx.sale.update({
        where: { id: sale.id },
        data: {
          costOfCurrencySoldMru: new Prisma.Decimal(costOfSold.toString()),
          grossProfitMru: new Prisma.Decimal(grossProfit.toString()),
        },
      });

      // --- 9. Audit ------------------------------------------------------
      await this.audit.log(tx, {
        action: 'sale_created',
        actorUserId: actorId,
        entityType: 'sale',
        entityId: updated.id,
        after: {
          deliveredCurrencyCode: deliveredCurrency.code,
          deliveredAmount: updated.deliveredAmount.toString(),
          paymentCurrencyCode: paymentCurrency.code,
          paymentTotal: updated.paymentTotal.toString(),
          rate: updated.rate.toString(),
          immediatePayment: updated.immediatePayment.toString(),
          paymentStatus: updated.paymentStatus,
          costOfCurrencySoldMru: updated.costOfCurrencySoldMru.toString(),
          grossProfitMru: updated.grossProfitMru.toString(),
        },
        ip,
      });

      return updated;
    });
  }
}
