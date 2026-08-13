import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service.js';
import { Decimal } from '../common/money.js';

// CashFlowService — groups ledger entries by payment method and currency (P7-02).
//
// The D-020 payoff: the operator can reconcile their Bankily / Masrivi /
// Sedad statements against the recorded ledger entries.
//
// No cross-currency summation (conventions §8, rule 6). Each
// (payment_method, currency) pair is a separate row so MRU BANKILY in
// and USD CASH in are never added together. The frontend renders
// currency as a column.
//
// Only rows with a payment_method_id are included — the traded-currency
// legs of purchases and sales have a NULL method in v1 (D-020) and are
// excluded.

export interface CashFlowLeg {
  currencyCode: string;
  creditsTotal: string;
  debitsTotal: string;
}

export interface CashFlowMethodRow {
  paymentMethodId: string;
  paymentMethodName: string;
  byLeg: CashFlowLeg[];
}

export interface CashFlowReport {
  from: string;
  to: string;
  methods: CashFlowMethodRow[];
}

@Injectable()
export class CashFlowService {
  constructor(private readonly prisma: PrismaService) {}

  async report(from: Date, to: Date): Promise<CashFlowReport> {
    const rows = await this.prisma.$queryRaw<
      {
        method_id: string;
        method_code: string;
        currency_code: string;
        direction: string;
        total: string;
      }[]
    >(Prisma.sql`
      SELECT
        pm."id" AS method_id,
        pm."code" AS method_code,
        c."code" AS currency_code,
        cl."direction",
        SUM(cl."amount")::text AS total
      FROM "currency_ledger" cl
      JOIN "payment_method" pm ON pm."id" = cl."payment_method_id"
      JOIN "currency" c ON c."id" = cl."currency_id"
      WHERE cl."payment_method_id" IS NOT NULL
        AND cl."is_active" = true
        AND cl."transaction_date" >= ${from}
        AND cl."transaction_date" <  ${to}
      GROUP BY pm."id", pm."code", c."code", cl."direction"
      ORDER BY pm."code", c."code", cl."direction"
    `);

    // Group into method → leg → direction aggregation
    const methodMap = new Map<
      string,
      { name: string; legs: Map<string, { credit: Decimal; debit: Decimal }> }
    >();

    for (const row of rows) {
      let method = methodMap.get(row.method_id);
      if (!method) {
        method = { name: row.method_code, legs: new Map() };
        methodMap.set(row.method_id, method);
      }
      let leg = method.legs.get(row.currency_code);
      if (!leg) {
        leg = { credit: new Decimal(0), debit: new Decimal(0) };
        method.legs.set(row.currency_code, leg);
      }
      const amount = new Decimal(row.total);
      if (row.direction === 'CREDIT') {
        leg.credit = leg.credit.plus(amount);
      } else {
        leg.debit = leg.debit.plus(amount);
      }
    }

    const methods: CashFlowMethodRow[] = [];
    for (const [methodId, { name, legs }] of methodMap) {
      const byLeg: CashFlowLeg[] = [];
      for (const [currencyCode, { credit, debit }] of legs) {
        byLeg.push({
          currencyCode,
          creditsTotal: credit.toFixed(4),
          debitsTotal: debit.toFixed(4),
        });
      }
      methods.push({ paymentMethodId: methodId, paymentMethodName: name, byLeg });
    }

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      methods,
    };
  }
}
