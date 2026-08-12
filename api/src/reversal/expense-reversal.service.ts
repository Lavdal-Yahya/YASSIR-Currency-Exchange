import { Injectable } from '@nestjs/common';
import type { Expense } from '@prisma/client';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../common/prisma.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import {
  AlreadyReversedError,
  ReversalReasonRequiredError,
  ReversalTargetNotFoundError,
} from './errors.js';

// ExpenseReversalService — phase-6.md §3, P6-03.
//
// Simpler than PaymentReversalService — expenses have no allocations to
// recompute. One transaction:
//   1. Load + guard (AlreadyReversedError on repeat).
//   2. Flip expense.status = REVERSED with reason + actor + timestamp.
//   3. LedgerService.deactivateBySource('expense', expenseId) — rolls
//      back balance cache, replays cost engine for the affected
//      currency (typically the base currency, so replay is a no-op per
//      D-006 rule 1).
//   4. Audit `expense_reversed`.

@Injectable()
export class ExpenseReversalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  async reverse(
    expenseId: string,
    actorId: string,
    reason: string,
    ip: string | null,
  ): Promise<Expense> {
    const trimmedReason = reason.trim();
    if (trimmedReason === '') {
      throw new ReversalReasonRequiredError({ entityType: 'expense', entityId: expenseId });
    }

    return this.prisma.$transaction(async (tx) => {
      const expense = await tx.expense.findUnique({ where: { id: expenseId } });
      if (!expense) {
        throw new ReversalTargetNotFoundError({ entityType: 'expense', entityId: expenseId });
      }
      if (expense.status === 'REVERSED') {
        throw new AlreadyReversedError({ entityType: 'expense', entityId: expenseId });
      }

      const now = new Date();
      const beforeSnapshot = {
        status: expense.status,
        amount: expense.amount.toString(),
        currencyId: expense.currencyId,
        expenseCategoryId: expense.expenseCategoryId,
      };
      const reversed = await tx.expense.update({
        where: { id: expenseId },
        data: {
          status: 'REVERSED',
          reversalReason: trimmedReason,
          reversedByUserId: actorId,
          reversedAt: now,
        },
      });

      await this.ledger.deactivateBySource(tx, 'expense', expenseId);

      await this.audit.log(tx, {
        action: 'expense_reversed',
        actorUserId: actorId,
        entityType: 'expense',
        entityId: expenseId,
        reason: trimmedReason,
        before: beforeSnapshot,
        after: {
          status: 'REVERSED',
          reversedAt: now.toISOString(),
          reversedByUserId: actorId,
        },
        ip,
      });

      return reversed;
    });
  }
}
