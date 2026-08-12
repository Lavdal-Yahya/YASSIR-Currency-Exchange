import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service.js';

// UserActivityService — spec §23.10. Per-user counts over a period of:
//   · purchases + sales created
//   · payments received/paid
//   · expenses recorded
//   · reversals performed (across all four target types)
//   · failed logins (from audit_log)
//
// Reversal counts include the user only when *they* reversed the row —
// creation counts are separate. This lets the owner see who is doing
// creates vs. who is doing undos, per the intent of the spec section.
//
// No new table — everything falls out of counts on existing rows and the
// audit_log for failed logins.

export interface UserActivityRow {
  userId: string;
  fullName: string;
  purchasesCreated: number;
  salesCreated: number;
  paymentsCreated: number;
  expensesCreated: number;
  reversalsPerformed: number;
  failedLogins: number;
}

@Injectable()
export class UserActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async report(from: Date, to: Date): Promise<UserActivityRow[]> {
    // Get all users; we'll left-join counts.
    const users = await this.prisma.user.findMany({
      orderBy: { fullName: 'asc' },
      select: { id: true, fullName: true },
    });

    // Parallel per-user aggregations — one round-trip per metric.
    const [purchases, sales, payments, expenses, reversals, failedLogins] = await Promise.all([
      this.countBy(from, to, 'purchase', 'created_by_user_id', 'transaction_date'),
      this.countBy(from, to, 'sale', 'created_by_user_id', 'transaction_date'),
      this.countBy(from, to, 'payment', 'created_by_user_id', 'transaction_date'),
      this.countBy(from, to, 'expense', 'created_by_user_id', 'transaction_date'),
      this.countReversals(from, to),
      this.countFailedLogins(from, to),
    ]);

    return users.map((u) => ({
      userId: u.id,
      fullName: u.fullName,
      purchasesCreated: purchases.get(u.id) ?? 0,
      salesCreated: sales.get(u.id) ?? 0,
      paymentsCreated: payments.get(u.id) ?? 0,
      expensesCreated: expenses.get(u.id) ?? 0,
      reversalsPerformed: reversals.get(u.id) ?? 0,
      failedLogins: failedLogins.get(u.id) ?? 0,
    }));
  }

  private async countBy(
    from: Date,
    to: Date,
    table: 'purchase' | 'sale' | 'payment' | 'expense',
    userCol: string,
    dateCol: string,
  ): Promise<Map<string, number>> {
    // Table + column names are literals here, not user input — safe from
    // injection. Using $queryRawUnsafe because table names cannot be
    // parameterised in Postgres.
    const sql = `
      SELECT "${userCol}" AS user_id, COUNT(*)::int AS n
      FROM "${table}"
      WHERE "${dateCol}" >= $1 AND "${dateCol}" < $2
      GROUP BY "${userCol}"
    `;
    const rows = await this.prisma.$queryRawUnsafe<{ user_id: string; n: number }[]>(sql, from, to);
    return new Map(rows.map((r) => [r.user_id, Number(r.n)]));
  }

  private async countReversals(from: Date, to: Date): Promise<Map<string, number>> {
    // Union across the four reversal-bearing tables. reversed_at is null
    // when the row was never reversed, so the WHERE also excludes those.
    const rows = await this.prisma.$queryRaw<{ user_id: string; n: number }[]>`
      SELECT "reversed_by_user_id" AS user_id, COUNT(*)::int AS n
      FROM (
        SELECT "reversed_by_user_id", "reversed_at" FROM "purchase" WHERE "status" = 'REVERSED'
        UNION ALL
        SELECT "reversed_by_user_id", "reversed_at" FROM "sale"     WHERE "status" = 'REVERSED'
        UNION ALL
        SELECT "reversed_by_user_id", "reversed_at" FROM "payment"  WHERE "status" = 'REVERSED'
        UNION ALL
        SELECT "reversed_by_user_id", "reversed_at" FROM "expense"  WHERE "status" = 'REVERSED'
      ) t
      WHERE t."reversed_by_user_id" IS NOT NULL
        AND t."reversed_at" >= ${from}
        AND t."reversed_at" <  ${to}
      GROUP BY t."reversed_by_user_id"
    `;
    return new Map(rows.map((r) => [r.user_id, Number(r.n)]));
  }

  private async countFailedLogins(from: Date, to: Date): Promise<Map<string, number>> {
    // The auth module writes 'login_failed' rows to audit_log with the
    // attempted user's id in actor_user_id when the user exists (P1-05).
    // Failed attempts against unknown phones carry a null actor and are
    // not attributable — those are omitted here by construction.
    const rows = await this.prisma.$queryRaw<{ actor_user_id: string; n: number }[]>`
      SELECT "actor_user_id", COUNT(*)::int AS n
      FROM "audit_log"
      WHERE "action" = 'login_failed'
        AND "actor_user_id" IS NOT NULL
        AND "created_at" >= ${from}
        AND "created_at" <  ${to}
      GROUP BY "actor_user_id"
    `;
    return new Map(rows.map((r) => [r.actor_user_id, Number(r.n)]));
  }
}
