import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service.js';
import { CurrencyNotFoundError } from '../currencies/errors.js';

// Read-only façade over currency_balance + currency_cost + currency.
// This is what /balances calls; the dashboard card in P3-11 renders
// the returned shape directly.
//
// The `lastMovementAt` field is one indexed query per row — cheap in
// the P3 volumes and it keeps the endpoint useful (spec §22.3: low-
// balance warning + last movement date on the dashboard card).

export interface BalanceRow {
  currencyId: string;
  code: string;
  name: string;
  symbol: string | null;
  decimalPlaces: number;
  lowBalanceThreshold: string | null;
  cachedAmount: string;
  cachedAvgMru: string;
  cachedQuantity: string;
  lastMovementAt: Date | null;
}

@Injectable()
export class BalancesReadService {
  constructor(private readonly prisma: PrismaService) {}

  async listActive(): Promise<BalanceRow[]> {
    const currencies = await this.prisma.currency.findMany({
      where: { isActive: true },
      orderBy: { code: 'asc' },
      include: { balance: true, cost: true },
    });
    // One indexed query per currency for the last-movement-at column.
    // At P3 volumes (single-digit non-base currencies) that's fine; if
    // it starts to bite in P7's dashboard, replace with a single
    // GROUP BY currency_id, MAX(transaction_date) query.
    return Promise.all(
      currencies.map(async (c) => {
        const last = await this.prisma.currencyLedger.findFirst({
          where: { currencyId: c.id, isActive: true },
          orderBy: { transactionDate: 'desc' },
          select: { transactionDate: true },
        });
        return {
          currencyId: c.id,
          code: c.code,
          name: c.name,
          symbol: c.symbol,
          decimalPlaces: c.decimalPlaces,
          lowBalanceThreshold: c.lowBalanceThreshold?.toString() ?? null,
          cachedAmount: c.balance?.cachedAmount.toString() ?? '0',
          cachedAvgMru: c.cost?.cachedAvgMru.toString() ?? '0',
          cachedQuantity: c.cost?.cachedQuantity.toString() ?? '0',
          lastMovementAt: last?.transactionDate ?? null,
        };
      }),
    );
  }

  async getOne(currencyId: string): Promise<BalanceRow> {
    const c = await this.prisma.currency.findUnique({
      where: { id: currencyId },
      include: { balance: true, cost: true },
    });
    if (!c) throw new CurrencyNotFoundError(currencyId);
    const last = await this.prisma.currencyLedger.findFirst({
      where: { currencyId: c.id, isActive: true },
      orderBy: { transactionDate: 'desc' },
      select: { transactionDate: true },
    });
    return {
      currencyId: c.id,
      code: c.code,
      name: c.name,
      symbol: c.symbol,
      decimalPlaces: c.decimalPlaces,
      lowBalanceThreshold: c.lowBalanceThreshold?.toString() ?? null,
      cachedAmount: c.balance?.cachedAmount.toString() ?? '0',
      cachedAvgMru: c.cost?.cachedAvgMru.toString() ?? '0',
      cachedQuantity: c.cost?.cachedQuantity.toString() ?? '0',
      lastMovementAt: last?.transactionDate ?? null,
    };
  }
}
