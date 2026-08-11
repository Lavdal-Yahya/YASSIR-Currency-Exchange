import { Injectable } from '@nestjs/common';
import { Prisma, type Payment } from '@prisma/client';
import { AuditService } from '../audit/audit.service.js';
import { InactiveCurrencyError } from '../common/errors/ledger.errors.js';
import { Decimal } from '../common/money.js';
import { PrismaService } from '../common/prisma.service.js';
import { ContactNotFoundError } from '../contacts/errors.js';
import { CurrencyNotFoundError } from '../currencies/errors.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { CreateCustomerPaymentDto } from './dto/create-customer-payment.dto.js';
import {
  ContactNotCustomerError,
  NoActiveReceivablesError,
  NonBaseCurrencyPaymentNeedsRateError,
  PaymentExceedsOutstandingError,
} from './errors.js';
import { RecomputeService } from './recompute.service.js';

// CustomerPaymentService.create — spec §3 seven-step contract.
//
// 1. Validate: contact exists and isCustomer, currency active, amount > 0.
// 2. Default allocation: oldest-first over contact's active receivables
//    in the same currency, filling until the payment amount is exhausted.
// 3. Overpayment blocked (spec §15.4).
// 4. Transaction: insert payment, insert allocations, LedgerService.apply
//    (CREDIT on the payment currency with paymentMethodId + note).
// 5. RecomputeService.recompute on each targeted receivable (D-011,
//    never delta-patch).
// 6. Update receivable payment_status (UNPAID→PARTIALLY_PAID/PAID) and
//    status (OPEN→CLOSED when fully settled).
// 7. Audit payment.created.

@Injectable()
export class CustomerPaymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly recompute: RecomputeService,
    private readonly audit: AuditService,
  ) {}

  async create(
    actorId: string,
    dto: CreateCustomerPaymentDto,
    ip: string | null,
  ): Promise<Payment> {
    return this.prisma.$transaction(async (tx) => {
      // --- 1. Validate contact -----------------------------------------------
      const contact = await tx.contact.findUnique({ where: { id: dto.contactId } });
      if (!contact) throw new ContactNotFoundError(dto.contactId);
      if (!contact.isCustomer) throw new ContactNotCustomerError(dto.contactId);

      // --- 2. Validate currency -----------------------------------------------
      const settings = await tx.settings.findUniqueOrThrow({ where: { id: 1 } });
      const currency = await tx.currency.findUnique({ where: { id: dto.currencyId } });
      if (!currency) throw new CurrencyNotFoundError(dto.currencyId);
      if (!currency.isActive) throw new InactiveCurrencyError(currency.code);

      const amount = new Decimal(dto.amount);
      const isBase = dto.currencyId === settings.baseCurrencyId;

      // --- 3. Load active receivables (oldest-first) -------------------------
      // Cross-currency settlement is forbidden (spec §15.2) — the WHERE clause
      // enforces same currency. Status OPEN or CLOSED-but-not-REVERSED and
      // paymentStatus not PAID means still has outstanding balance.
      const receivables = await tx.receivable.findMany({
        where: {
          contactId: dto.contactId,
          currencyId: dto.currencyId,
          status: { not: 'REVERSED' },
          paymentStatus: { not: 'PAID' },
        },
        orderBy: { createdAt: 'asc' },
      });

      if (receivables.length === 0) {
        throw new NoActiveReceivablesError({
          contactId: dto.contactId,
          currencyCode: currency.code,
        });
      }

      // --- 4. Overpayment check (spec §15.4) ---------------------------------
      const totalOutstanding = receivables.reduce(
        (acc, r) => acc.plus(r.outstandingAmount.toString()),
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
      const allocationPlan: { receivableId: string; allocAmount: Decimal }[] = [];
      let remaining = amount;
      for (const r of receivables) {
        if (remaining.lte(0)) break;
        const outstanding = new Decimal(r.outstandingAmount.toString());
        const allocated = Decimal.min(remaining, outstanding);
        allocationPlan.push({ receivableId: r.id, allocAmount: allocated });
        remaining = remaining.minus(allocated);
      }

      // --- 6. Resolve unitCostMru for non-base acquisitions ------------------
      let unitCostMru: string | undefined;
      if (!isBase) {
        if (dto.unitCostMru) {
          unitCostMru = dto.unitCostMru;
        } else {
          const costRow = await tx.currencyCost.findUnique({
            where: { currencyId: dto.currencyId },
          });
          const wac = costRow ? new Decimal(costRow.cachedAvgMru.toString()) : new Decimal(0);
          if (wac.lte(0)) {
            throw new NonBaseCurrencyPaymentNeedsRateError({ currencyCode: currency.code });
          }
          unitCostMru = wac.toString();
        }
      }

      const transactionDate = dto.transactionDate ? new Date(dto.transactionDate) : new Date();

      // --- 7. Insert payment row ---------------------------------------------
      const payment = await tx.payment.create({
        data: {
          contactId: dto.contactId,
          currencyId: dto.currencyId,
          amount: new Prisma.Decimal(amount.toString()),
          direction: 'RECEIVED_FROM_CUSTOMER',
          paymentMethodId: dto.paymentMethodId,
          paymentMethodNote: dto.paymentMethodNote ?? null,
          status: 'CONFIRMED',
          reference: dto.reference ?? null,
          notes: dto.notes ?? null,
          transactionDate,
          createdByUserId: actorId,
        },
      });

      // --- 8. Insert allocation rows -----------------------------------------
      for (const { receivableId, allocAmount } of allocationPlan) {
        await tx.allocation.create({
          data: {
            paymentId: payment.id,
            targetType: 'receivable',
            targetId: receivableId,
            amount: new Prisma.Decimal(allocAmount.toString()),
          },
        });
      }

      // --- 9. Apply ledger (CREDIT the payment currency) --------------------
      await this.ledger.apply(tx, [
        {
          currencyId: dto.currencyId,
          direction: 'CREDIT',
          amount,
          sourceType: 'payment',
          sourceId: payment.id,
          paymentMethodId: dto.paymentMethodId,
          note: dto.paymentMethodNote ?? null,
          transactionDate,
          description: `Customer payment — ${contact.name}`,
          createdByUserId: actorId,
          unitCostMru,
        },
      ]);

      // --- 10. Recompute outstanding + update receivable status (D-011) -----
      const receivableById = new Map(receivables.map((r) => [r.id, r]));
      for (const { receivableId } of allocationPlan) {
        const r = receivableById.get(receivableId)!;
        const newOutstanding = await this.recompute.recompute(tx, {
          id: r.id,
          targetType: 'receivable',
          originalAmount: new Decimal(r.originalAmount.toString()),
        });

        const newPaymentStatus = newOutstanding.eq(0) ? 'PAID' : 'PARTIALLY_PAID';
        const newStatus = newOutstanding.eq(0) ? 'CLOSED' : r.status;

        await tx.receivable.update({
          where: { id: r.id },
          data: {
            outstandingAmount: new Prisma.Decimal(newOutstanding.toString()),
            paymentStatus: newPaymentStatus,
            status: newStatus,
          },
        });
      }

      // --- 11. Audit --------------------------------------------------------
      await this.audit.log(tx, {
        action: 'payment_created',
        actorUserId: actorId,
        entityType: 'payment',
        entityId: payment.id,
        after: {
          contactId: dto.contactId,
          currencyCode: currency.code,
          amount: amount.toString(),
          direction: 'RECEIVED_FROM_CUSTOMER',
          targetReceivableIds: allocationPlan.map((a) => a.receivableId),
        },
        ip,
      });

      return payment;
    });
  }
}
