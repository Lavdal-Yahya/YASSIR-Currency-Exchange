import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service.js';
import { Decimal } from '../common/money.js';
import { startOfPeriod, endOfPeriod } from '../common/period.js';

// DashboardService — operational snapshot for the dashboard (P7-01).
//
// Returns today's purchases/sales totals plus open debt counts.
// Everything is read-only; no ledger writes.
//
// "Today" is the current calendar day in the business timezone (D-012).
// All MRU totals use the base-currency leg of each trade (payment_total
// for sales, payment_total for purchases where the payment currency is MRU).
//
// Open debt totals are MRU-denominated only — never add across currencies
// (conventions §8, rule 6). The `hasNonMruDebts` flag alerts the frontend
// when non-MRU debts exist but are excluded from the sum.

export interface DashboardTodayTotals {
  count: number;
  totalMru: string;
}

export interface OpenDebtSummary {
  count: number;
  totalMru: string;
  hasNonMruDebts: boolean;
}

export interface LowBalanceCurrency {
  code: string;
  cachedAmount: string;
  threshold: string;
}

export interface DashboardSummary {
  todayPurchases: DashboardTodayTotals;
  todaySales: DashboardTodayTotals;
  todayNetMru: string;
  openReceivables: OpenDebtSummary;
  openPayables: OpenDebtSummary;
  lowBalanceCurrencies: LowBalanceCurrency[];
}

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(now: Date): Promise<DashboardSummary> {
    const todayStart = startOfPeriod(now, 'day');
    const todayEnd = endOfPeriod(now, 'day');

    const settings = await this.prisma.settings.findUniqueOrThrow({ where: { id: 1 } });
    const baseCurrencyId = settings.baseCurrencyId;

    const [purchaseRows, saleRows, receivableRows, payableRows, currencies] = await Promise.all([
      this.prisma.$queryRaw<{ cnt: string; total: string }[]>(Prisma.sql`
        SELECT COUNT(*)::text AS cnt,
               COALESCE(SUM(p."payment_total"), 0)::text AS total
        FROM "purchase" p
        WHERE p."status" = 'CONFIRMED'
          AND p."payment_currency_id" = ${baseCurrencyId}::uuid
          AND p."transaction_date" >= ${todayStart}
          AND p."transaction_date" <  ${todayEnd}
      `),

      this.prisma.$queryRaw<{ cnt: string; total: string }[]>(Prisma.sql`
        SELECT COUNT(*)::text AS cnt,
               COALESCE(SUM(s."payment_total"), 0)::text AS total
        FROM "sale" s
        WHERE s."status" = 'CONFIRMED'
          AND s."payment_currency_id" = ${baseCurrencyId}::uuid
          AND s."transaction_date" >= ${todayStart}
          AND s."transaction_date" <  ${todayEnd}
      `),

      this.prisma.$queryRaw<{ cnt: string; total: string; has_non_mru: boolean }[]>(Prisma.sql`
        SELECT
          COUNT(CASE WHEN r."currency_id" = ${baseCurrencyId}::uuid THEN 1 END)::text AS cnt,
          COALESCE(SUM(
            CASE WHEN r."currency_id" = ${baseCurrencyId}::uuid THEN r."outstanding_amount" ELSE 0 END
          ), 0)::text AS total,
          BOOL_OR(r."currency_id" <> ${baseCurrencyId}::uuid) AS has_non_mru
        FROM "receivable" r
        WHERE r."status" = 'OPEN'
      `),

      this.prisma.$queryRaw<{ cnt: string; total: string; has_non_mru: boolean }[]>(Prisma.sql`
        SELECT
          COUNT(CASE WHEN p."currency_id" = ${baseCurrencyId}::uuid THEN 1 END)::text AS cnt,
          COALESCE(SUM(
            CASE WHEN p."currency_id" = ${baseCurrencyId}::uuid THEN p."outstanding_amount" ELSE 0 END
          ), 0)::text AS total,
          BOOL_OR(p."currency_id" <> ${baseCurrencyId}::uuid) AS has_non_mru
        FROM "payable" p
        WHERE p."status" = 'OPEN'
      `),

      this.prisma.currency.findMany({
        where: { isActive: true, lowBalanceThreshold: { not: null } },
        include: { balance: true },
      }),
    ]);

    const purchases = purchaseRows[0] ?? { cnt: '0', total: '0' };
    const sales = saleRows[0] ?? { cnt: '0', total: '0' };
    const recv = receivableRows[0] ?? { cnt: '0', total: '0', has_non_mru: false };
    const pay = payableRows[0] ?? { cnt: '0', total: '0', has_non_mru: false };

    const totalPurchasesMru = new Decimal(purchases.total);
    const totalSalesMru = new Decimal(sales.total);
    const netMru = totalSalesMru.minus(totalPurchasesMru);

    const lowBalanceCurrencies: LowBalanceCurrency[] = currencies.flatMap((c) => {
      const threshold = c.lowBalanceThreshold;
      if (threshold === null) return [];
      const cached = c.balance?.cachedAmount ?? new Decimal(0);
      const cachedDec = new Decimal(cached.toString());
      const thresholdDec = new Decimal(threshold.toString());
      if (!cachedDec.lte(thresholdDec)) return [];
      return [
        {
          code: c.code,
          cachedAmount: cached.toString(),
          threshold: threshold.toString(),
        },
      ];
    });

    return {
      todayPurchases: {
        count: Number(purchases.cnt),
        totalMru: totalPurchasesMru.toFixed(4),
      },
      todaySales: {
        count: Number(sales.cnt),
        totalMru: totalSalesMru.toFixed(4),
      },
      todayNetMru: netMru.toFixed(4),
      openReceivables: {
        count: Number(recv.cnt),
        totalMru: new Decimal(recv.total).toFixed(4),
        hasNonMruDebts: recv.has_non_mru ?? false,
      },
      openPayables: {
        count: Number(pay.cnt),
        totalMru: new Decimal(pay.total).toFixed(4),
        hasNonMruDebts: pay.has_non_mru ?? false,
      },
      lowBalanceCurrencies,
    };
  }
}
