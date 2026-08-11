import { Injectable } from '@nestjs/common';
import { LedgerContractError } from '../common/errors/ledger.errors.js';
import { Decimal } from '../common/money.js';
import type { Tx } from '../ledger/ledger.types.js';

export interface RecomputeTarget {
  id: string;
  targetType: 'receivable' | 'payable';
  originalAmount: Decimal;
}

// RecomputeService — derives outstanding_amount from live allocations.
//
// D-011: allocation liveness — an allocation counts if and only if its
// payment row (status = CONFIRMED) is active. The target's own status
// is checked by the caller before deciding to call recompute; a REVERSED
// target is not recomputed (it's closed). We sum confirmed-payment
// allocations only.
//
// Idempotent: calling twice produces the same result. Shared by
// CustomerPaymentService (P5-02), SupplierPaymentService (P5-03), and
// the reversal path in P6.

@Injectable()
export class RecomputeService {
  async recompute(tx: Tx, target: RecomputeTarget): Promise<Decimal> {
    const rows = await tx.$queryRaw<{ sum: string }[]>`
      SELECT COALESCE(SUM(a."amount"), 0)::text AS sum
      FROM "allocation" a
      JOIN "payment" p ON p."id" = a."payment_id"
      WHERE a."target_type" = ${target.targetType}
        AND a."target_id" = ${target.id}::uuid
        AND p."status" = 'CONFIRMED'
    `;

    const paidSum = new Decimal(rows[0]?.sum ?? '0');
    const outstanding = target.originalAmount.minus(paidSum);

    if (outstanding.lt(0)) {
      // Impossible if INV-5 holds — treat as a bug, not a user error.
      throw new LedgerContractError(
        'recomputed outstanding is negative — allocation liveness invariant violated (INV-5)',
        {
          targetType: target.targetType,
          targetId: target.id,
          originalAmount: target.originalAmount.toString(),
          paidSum: paidSum.toString(),
        },
      );
    }

    return outstanding;
  }
}
