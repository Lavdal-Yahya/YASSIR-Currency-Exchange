import { Injectable } from '@nestjs/common';
import { Prisma, type Payment } from '@prisma/client';
import { AuditService } from '../audit/audit.service.js';
import { InactiveCurrencyError } from '../common/errors/ledger.errors.js';
import { Decimal } from '../common/money.js';
import { mustGet } from '../common/must-get.js';
import { PrismaService } from '../common/prisma.service.js';
import { ContactNotFoundError } from '../contacts/errors.js';
import { CurrencyNotFoundError } from '../currencies/errors.js';
import { LedgerService } from '../ledger/ledger.service.js';
import type { Movement } from '../ledger/ledger.types.js';
import { CreateSupplierPaymentDto } from './dto/create-supplier-payment.dto.js';
import {
  ContactNotSupplierError,
  NoActivePayablesError,
  PaymentExceedsOutstandingError,
} from './errors.js';
import { RecomputeService } from './recompute.service.js';

// SupplierPaymentService.create — mirror of CustomerPaymentService with one
// addition: for non-base payables, the ledger DEBIT carries disposalValueMru
// derived from the originating purchase's stored rate (D-017). This is looked
// up per allocation because different payables may have different original
// rates. Realized P&L = disposalValueMru − qty × WAC (FX gain on settlement).

@Injectable()
export class SupplierPaymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly recompute: RecomputeService,
    private readonly audit: AuditService,
  ) {}

  async create(
    actorId: string,
    dto: CreateSupplierPaymentDto,
    ip: string | null,
  ): Promise<Payment> {
    return this.prisma.$transaction(async (tx) => {
      // --- 1. Validate contact -----------------------------------------------
      const contact = await tx.contact.findUnique({ where: { id: dto.contactId } });
      if (!contact) throw new ContactNotFoundError(dto.contactId);
      if (!contact.isSupplier) throw new ContactNotSupplierError(dto.contactId);

      // --- 2. Validate currency -----------------------------------------------
      const settings = await tx.settings.findUniqueOrThrow({ where: { id: 1 } });
      const currency = await tx.currency.findUnique({ where: { id: dto.currencyId } });
      if (!currency) throw new CurrencyNotFoundError(dto.currencyId);
      if (!currency.isActive) throw new InactiveCurrencyError(currency.code);

      const amount = new Decimal(dto.amount);
      const isBase = dto.currencyId === settings.baseCurrencyId;

      // --- 3. Load active payables (oldest-first) ----------------------------
      const payables = await tx.payable.findMany({
        where: {
          contactId: dto.contactId,
          currencyId: dto.currencyId,
          status: { not: 'REVERSED' },
          paymentStatus: { not: 'PAID' },
        },
        orderBy: { createdAt: 'asc' },
      });

      if (payables.length === 0) {
        throw new NoActivePayablesError({
          contactId: dto.contactId,
          currencyCode: currency.code,
        });
      }

      // --- 4. Overpayment check (spec §15.4) ---------------------------------
      const totalOutstanding = payables.reduce(
        (acc, p) => acc.plus(p.outstandingAmount.toString()),
        new Decimal(0),
      );
      if (amount.gt(totalOutstanding)) {
        throw new PaymentExceedsOutstandingError({
          requested: amount.toString(),
          outstanding: totalOutstanding.toString(),
          currencyCode: currency.code,
        });
      }

      // --- 5. Build allocation plan (oldest-first fill) ----------------------
      const allocationPlan: { payableId: string; allocAmount: Decimal }[] = [];
      let remaining = amount;
      for (const p of payables) {
        if (remaining.lte(0)) break;
        const outstanding = new Decimal(p.outstandingAmount.toString());
        const allocated = Decimal.min(remaining, outstanding);
        allocationPlan.push({ payableId: p.id, allocAmount: allocated });
        remaining = remaining.minus(allocated);
      }

      const transactionDate = dto.transactionDate ? new Date(dto.transactionDate) : new Date();

      // --- 6. Insert payment row ---------------------------------------------
      const payment = await tx.payment.create({
        data: {
          contactId: dto.contactId,
          currencyId: dto.currencyId,
          amount: new Prisma.Decimal(amount.toString()),
          direction: 'PAID_TO_SUPPLIER',
          paymentMethodId: dto.paymentMethodId,
          paymentMethodNote: dto.paymentMethodNote ?? null,
          status: 'CONFIRMED',
          reference: dto.reference ?? null,
          notes: dto.notes ?? null,
          transactionDate,
          createdByUserId: actorId,
        },
      });

      // --- 7. Insert allocation rows -----------------------------------------
      for (const { payableId, allocAmount } of allocationPlan) {
        await tx.allocation.create({
          data: {
            paymentId: payment.id,
            targetType: 'payable',
            targetId: payableId,
            amount: new Prisma.Decimal(allocAmount.toString()),
          },
        });
      }

      // --- 8. Build ledger movements (one per allocation for D-017) ----------
      // For non-base payables: each allocation may carry a different original
      // MRU rate derived from its originating purchase. Building one movement
      // per allocation preserves per-allocation P&L accuracy.
      // For base (MRU) payables: CostEngine skips the base currency, so
      // disposalValueMru is irrelevant — one movement for the whole amount.
      let movements: Movement[];

      if (isBase) {
        movements = [
          {
            currencyId: dto.currencyId,
            direction: 'DEBIT',
            amount,
            sourceType: 'payment',
            sourceId: payment.id,
            paymentMethodId: dto.paymentMethodId,
            note: dto.paymentMethodNote ?? null,
            transactionDate,
            description: `Supplier payment — ${contact.name}`,
            createdByUserId: actorId,
          },
        ];
      } else {
        // Build a map of payable id → originating purchase for rate lookup.
        const payableById = new Map(payables.map((p) => [p.id, p]));
        const purchaseIds = allocationPlan.flatMap(({ payableId }) => {
          const pb = payableById.get(payableId);
          return pb?.sourceType === 'purchase' && pb.sourceId !== null ? [pb.sourceId] : [];
        });

        const purchaseRows =
          purchaseIds.length > 0
            ? await tx.purchase.findMany({ where: { id: { in: purchaseIds } } })
            : [];
        const purchaseById = new Map(purchaseRows.map((r) => [r.id, r]));

        movements = allocationPlan.map(({ payableId, allocAmount }) => {
          const payable = mustGet(payableById, payableId, 'payable');
          let disposalValueMru: string | undefined;

          if (payable.sourceType === 'purchase' && payable.sourceId) {
            const purchase = purchaseById.get(payable.sourceId);
            if (purchase) {
              // disposalValueMru = allocAmount × (deliveredAmount / paymentTotal)
              // = allocAmount at the original MRU-per-unit rate embedded in the
              // purchase. CostEngine then computes:
              //   realized_pnl = disposalValueMru − allocAmount × WAC (D-017)
              const originalRate = new Decimal(purchase.deliveredAmount.toString()).div(
                new Decimal(purchase.paymentTotal.toString()),
              );
              disposalValueMru = allocAmount.times(originalRate).toDecimalPlaces(4).toString();
            }
          }

          return {
            currencyId: dto.currencyId,
            direction: 'DEBIT' as const,
            amount: allocAmount,
            sourceType: 'payment',
            sourceId: payment.id,
            paymentMethodId: dto.paymentMethodId,
            note: dto.paymentMethodNote ?? null,
            transactionDate,
            description: `Supplier payment — ${contact.name}`,
            createdByUserId: actorId,
            ...(disposalValueMru !== undefined && { disposalValueMru }),
          };
        });
      }

      await this.ledger.apply(tx, movements);

      // --- 9. Recompute outstanding + update payable status (D-011) ----------
      const payableById = new Map(payables.map((p) => [p.id, p]));
      for (const { payableId } of allocationPlan) {
        const p = mustGet(payableById, payableId, 'payable');
        const newOutstanding = await this.recompute.recompute(tx, {
          id: p.id,
          targetType: 'payable',
          originalAmount: new Decimal(p.originalAmount.toString()),
        });

        const newPaymentStatus = newOutstanding.eq(0) ? 'PAID' : 'PARTIALLY_PAID';
        const newStatus = newOutstanding.eq(0) ? 'CLOSED' : p.status;

        await tx.payable.update({
          where: { id: p.id },
          data: {
            outstandingAmount: new Prisma.Decimal(newOutstanding.toString()),
            paymentStatus: newPaymentStatus,
            status: newStatus,
          },
        });
      }

      // --- 10. Audit ---------------------------------------------------------
      await this.audit.log(tx, {
        action: 'payment_created',
        actorUserId: actorId,
        entityType: 'payment',
        entityId: payment.id,
        after: {
          contactId: dto.contactId,
          currencyCode: currency.code,
          amount: amount.toString(),
          direction: 'PAID_TO_SUPPLIER',
          targetPayableIds: allocationPlan.map((a) => a.payableId),
        },
        ip,
      });

      return payment;
    });
  }
}
