import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service.js';
import { Decimal } from '../common/money.js';

// AgeingReportService — debt ageing buckets (P7-03).
//
// Aggregates CONFIRMED receivables and payables into age buckets based on
// how many days since the debt was created. Bucket boundaries: 0-30, 31-60,
// 61-90, 91+.
//
// Age is from `created_at` (collection age, not deal age — D-008 reasons
// apply to cost-movement ordering, not to when a debt is chased).
//
// Per-currency totals only — no cross-currency summation (conventions §8).
// The frontend renders one column per currency per bucket.

export interface AgeingBucket {
  count: number;
  byCurrency: Array<{ currencyCode: string; total: string }>;
}

export interface AgeingSection {
  current: AgeingBucket; // 0-30 days
  bucket31to60: AgeingBucket;
  bucket61to90: AgeingBucket;
  bucket91plus: AgeingBucket;
}

export interface AgeingReport {
  receivables: AgeingSection;
  payables: AgeingSection;
}

interface AgeingRow {
  currency_code: string;
  age_days: number;
  count: string;
  total: string;
}

@Injectable()
export class AgeingReportService {
  constructor(private readonly prisma: PrismaService) {}

  async report(now: Date): Promise<AgeingReport> {
    const [recvRows, payRows] = await Promise.all([
      this.prisma.$queryRaw<AgeingRow[]>(Prisma.sql`
        SELECT
          c."code" AS currency_code,
          EXTRACT(DAY FROM (${now} - r."created_at"))::int AS age_days,
          COUNT(*)::text AS count,
          SUM(r."outstanding_amount")::text AS total
        FROM "receivable" r
        JOIN "currency" c ON c."id" = r."currency_id"
        WHERE r."status" = 'OPEN'
        GROUP BY c."code", age_days
      `),

      this.prisma.$queryRaw<AgeingRow[]>(Prisma.sql`
        SELECT
          c."code" AS currency_code,
          EXTRACT(DAY FROM (${now} - p."created_at"))::int AS age_days,
          COUNT(*)::text AS count,
          SUM(p."outstanding_amount")::text AS total
        FROM "payable" p
        JOIN "currency" c ON c."id" = p."currency_id"
        WHERE p."status" = 'OPEN'
        GROUP BY c."code", age_days
      `),
    ]);

    return {
      receivables: buildSection(recvRows),
      payables: buildSection(payRows),
    };
  }
}

function buildSection(rows: AgeingRow[]): AgeingSection {
  const current = bucketAgg(rows.filter((r) => r.age_days <= 30));
  const b31 = bucketAgg(rows.filter((r) => r.age_days >= 31 && r.age_days <= 60));
  const b61 = bucketAgg(rows.filter((r) => r.age_days >= 61 && r.age_days <= 90));
  const b91 = bucketAgg(rows.filter((r) => r.age_days > 90));
  return { current, bucket31to60: b31, bucket61to90: b61, bucket91plus: b91 };
}

function bucketAgg(rows: AgeingRow[]): AgeingBucket {
  const byCurrency = new Map<string, { count: number; total: Decimal }>();
  for (const r of rows) {
    const existing = byCurrency.get(r.currency_code) ?? { count: 0, total: new Decimal(0) };
    byCurrency.set(r.currency_code, {
      count: existing.count + Number(r.count),
      total: existing.total.plus(new Decimal(r.total)),
    });
  }
  const totalCount = [...byCurrency.values()].reduce((s, v) => s + v.count, 0);
  return {
    count: totalCount,
    byCurrency: [...byCurrency.entries()].map(([currencyCode, { total }]) => ({
      currencyCode,
      total: total.toFixed(4),
    })),
  };
}
