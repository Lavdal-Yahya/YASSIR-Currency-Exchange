import { Injectable } from '@nestjs/common';
import { Prisma, type Purchase } from '@prisma/client';
import { AuditService } from '../audit/audit.service.js';
import { InactiveCurrencyError } from '../common/errors/ledger.errors.js';
import { Decimal } from '../common/money.js';
import { PrismaService } from '../common/prisma.service.js';
import { CurrencyNotFoundError } from '../currencies/errors.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { CreatePurchaseDto } from './dto/create-purchase.dto.js';
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

// PurchaseService — bureau receives `delivered_currency` and pays
// `payment_currency`. One $transaction per operation:
//
//   1. Idempotency check (P4-06). Repeat with same key + same body
//      returns the cached row; repeat with different body → 409.
//   2. Base-leg rule (D-019) — reject before any write.
//   3. Rate/total derivation (D-009) + strict-equality guard (D-024).
//   4. Insert purchase row. DB triggers re-check base leg + rate/total,
//      belt-and-braces.
//   5. Build Movement[] and call LedgerService.apply — the chokepoint.
//      Ledger writes fire; CostEngine records ACQUISITION or DISPOSAL
//      on the non-base leg.
//   6. Payable insert if outstanding > 0.
//   7. Audit.

@Injectable()
export class PurchaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  async create(actorId: string, dto: CreatePurchaseDto, ip: string | null): Promise<Purchase> {
    // Hash outside the transaction — pure function of the payload.
    const bodyHash = hashRequestBody(dto);

    return this.prisma.$transaction(async (tx) => {
      // --- 1. Idempotency ------------------------------------------------
      if (dto.idempotencyKey) {
        const existing = await tx.purchase.findFirst({
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

      // --- 5. Insert purchase row ---------------------------------------
      const transactionDate = dto.transactionDate ? new Date(dto.transactionDate) : new Date();

      const purchase = await tx.purchase.create({
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
        },
      });

      // --- 6. Build movements + apply ledger -----------------------------
      const movements = buildTradeMovements({
        kind: 'purchase',
        tradeId: purchase.id,
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

      // --- 7. Payable if outstanding > 0 ---------------------------------
      if (outstanding.gt(0)) {
        // dto.contactId is guaranteed present here by the walk-in
        // check above (step 4c).
        await tx.payable.create({
          data: {
            contactId: dto.contactId!,
            currencyId: dto.paymentCurrencyId,
            originalAmount: new Prisma.Decimal(outstanding.toString()),
            outstandingAmount: new Prisma.Decimal(outstanding.toString()),
            origin: 'TRADE',
            sourceType: 'purchase',
            sourceId: purchase.id,
          },
        });
      }

      // --- 8. Audit ------------------------------------------------------
      await this.audit.log(tx, {
        action: 'purchase_created',
        actorUserId: actorId,
        entityType: 'purchase',
        entityId: purchase.id,
        after: {
          deliveredCurrencyCode: deliveredCurrency.code,
          deliveredAmount: purchase.deliveredAmount.toString(),
          paymentCurrencyCode: paymentCurrency.code,
          paymentTotal: purchase.paymentTotal.toString(),
          rate: purchase.rate.toString(),
          immediatePayment: purchase.immediatePayment.toString(),
          paymentStatus: purchase.paymentStatus,
        },
        ip,
      });

      return purchase;
    });
  }
}
