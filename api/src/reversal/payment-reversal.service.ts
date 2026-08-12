import { Injectable } from '@nestjs/common';
import type { Payment } from '@prisma/client';
import { AuditService } from '../audit/audit.service.js';
import { Decimal } from '../common/money.js';
import { PrismaService } from '../common/prisma.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import type { Tx } from '../ledger/ledger.types.js';
import { RecomputeService } from '../payments/recompute.service.js';
import {
  AlreadyReversedError,
  ReversalReasonRequiredError,
  ReversalTargetNotFoundError,
} from './errors.js';

// PaymentReversalService — phase-6.md §3, P6-03.
//
// One transaction:
//   1. Load payment, verify it is CONFIRMED (else AlreadyReversedError).
//   2. Flip payment.status = REVERSED with reason + actor + timestamp.
//   3. LedgerService.deactivateBySource('payment', paymentId) — this is
//      the chokepoint-clean single call that undoes the ledger, cost,
//      and balance-cache effects and replays WAC forward.
//   4. Allocations lose liveness (payment is inactive → D-011 excludes
//      them from the recompute sum). Iterate each targeted debt and
//      re-derive its outstanding_amount + status transitions.
//   5. Audit `payment_reversed` with reason + before/after snapshots.
//
// Idempotency: a second call returns 422 AlreadyReversedError, not a
// silent success — the operator is trying to undo something that is
// already undone, and that is either a mistake or a race we want to
// surface.

@Injectable()
export class PaymentReversalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly recompute: RecomputeService,
    private readonly audit: AuditService,
  ) {}

  async reverse(
    paymentId: string,
    actorId: string,
    reason: string,
    ip: string | null,
  ): Promise<Payment> {
    const trimmedReason = reason.trim();
    if (trimmedReason === '') {
      throw new ReversalReasonRequiredError({ entityType: 'payment', entityId: paymentId });
    }

    return this.prisma.$transaction(async (tx) => {
      // --- 1. Load + guard ---------------------------------------------
      const payment = await tx.payment.findUnique({ where: { id: paymentId } });
      if (!payment) {
        throw new ReversalTargetNotFoundError({ entityType: 'payment', entityId: paymentId });
      }
      if (payment.status === 'REVERSED') {
        throw new AlreadyReversedError({ entityType: 'payment', entityId: paymentId });
      }

      // --- 2. Flip payment status --------------------------------------
      const now = new Date();
      const beforeSnapshot = {
        status: payment.status,
        amount: payment.amount.toString(),
        direction: payment.direction,
      };
      const reversed = await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: 'REVERSED',
          reversalReason: trimmedReason,
          reversedByUserId: actorId,
          reversedAt: now,
        },
      });

      // --- 3. Deactivate ledger + cost + roll back balance -------------
      await this.ledger.deactivateBySource(tx, 'payment', paymentId);

      // --- 4. Recompute affected receivables / payables ----------------
      const allocations = await tx.allocation.findMany({ where: { paymentId } });
      for (const a of allocations) {
        await this.recomputeTarget(tx, a.targetType as 'receivable' | 'payable', a.targetId);
      }

      // --- 5. Audit ----------------------------------------------------
      await this.audit.log(tx, {
        action: 'payment_reversed',
        actorUserId: actorId,
        entityType: 'payment',
        entityId: paymentId,
        reason: trimmedReason,
        before: beforeSnapshot,
        after: {
          status: 'REVERSED',
          reversedAt: now.toISOString(),
          reversedByUserId: actorId,
          allocationTargets: allocations.map((a) => ({ type: a.targetType, id: a.targetId })),
        },
        ip,
      });

      return reversed;
    });
  }

  private async recomputeTarget(
    tx: Tx,
    targetType: 'receivable' | 'payable',
    targetId: string,
  ): Promise<void> {
    if (targetType === 'receivable') {
      const target = await tx.receivable.findUnique({ where: { id: targetId } });
      if (!target) return;
      const newOutstanding = await this.recompute.recompute(tx, {
        id: target.id,
        targetType: 'receivable',
        originalAmount: new Decimal(target.originalAmount.toString()),
      });
      const original = new Decimal(target.originalAmount.toString());
      await tx.receivable.update({
        where: { id: target.id },
        data: {
          outstandingAmount: newOutstanding.toString(),
          paymentStatus: newOutstanding.eq(original)
            ? 'UNPAID'
            : newOutstanding.eq(0)
              ? 'PAID'
              : 'PARTIALLY_PAID',
          status: target.status === 'CLOSED' && newOutstanding.gt(0) ? 'OPEN' : target.status,
        },
      });
      return;
    }
    const target = await tx.payable.findUnique({ where: { id: targetId } });
    if (!target) return;
    const newOutstanding = await this.recompute.recompute(tx, {
      id: target.id,
      targetType: 'payable',
      originalAmount: new Decimal(target.originalAmount.toString()),
    });
    const original = new Decimal(target.originalAmount.toString());
    await tx.payable.update({
      where: { id: target.id },
      data: {
        outstandingAmount: newOutstanding.toString(),
        paymentStatus: newOutstanding.eq(original)
          ? 'UNPAID'
          : newOutstanding.eq(0)
            ? 'PAID'
            : 'PARTIALLY_PAID',
        status: target.status === 'CLOSED' && newOutstanding.gt(0) ? 'OPEN' : target.status,
      },
    });
  }
}
