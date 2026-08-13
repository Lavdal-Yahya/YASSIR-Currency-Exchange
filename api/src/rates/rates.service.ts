import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service.js';
import { Decimal } from '../common/money.js';
import { RATE_PROVIDER, type RateProvider } from './rate-provider.js';

// RatesService — read model + refresh coordinator for market-rate
// snapshots (P8-02).
//
// Everything here is informational (D-007 superseded, spec §21.2). A
// missing snapshot is fine; a bad provider is fine; the trade form's
// operator-typed rate is authoritative regardless. The only firm rule
// is the partial unique index on `is_current` — exactly one current
// row per currency, enforced by DB.

export interface CurrentRateRow {
  currencyId: string;
  currencyCode: string;
  midRateMru: string;
  source: string;
  fetchedAt: string;
}

export interface RateHistoryRow {
  id: string;
  midRateMru: string;
  source: string;
  fetchedAt: string;
  isCurrent: boolean;
}

export interface RefreshResult {
  refreshed: number;
  failed: number;
}

@Injectable()
export class RatesService {
  private readonly logger = new Logger(RatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(RATE_PROVIDER) private readonly provider: RateProvider,
  ) {}

  // Refresh — for each active non-base currency, ask the provider and
  // atomically flip the old is_current row while inserting the new one.
  // One transaction per currency so a slow provider on X doesn't block Y.
  async refresh(): Promise<RefreshResult> {
    const settings = await this.prisma.settings.findUniqueOrThrow({ where: { id: 1 } });
    const baseCurrency = await this.prisma.currency.findUniqueOrThrow({
      where: { id: settings.baseCurrencyId },
    });
    const currencies = await this.prisma.currency.findMany({
      where: { isActive: true, id: { not: baseCurrency.id } },
      orderBy: { code: 'asc' },
    });
    if (currencies.length === 0) {
      return { refreshed: 0, failed: 0 };
    }
    const targetCodes = currencies.map((c) => c.code);
    const codeToId = new Map(currencies.map((c) => [c.code, c.id]));

    let results: Awaited<ReturnType<RateProvider['fetch']>>;
    try {
      results = await this.provider.fetch(baseCurrency.code, targetCodes);
    } catch (err) {
      this.logger.error(`provider ${this.provider.name} failed: ${(err as Error).message ?? err}`);
      return { refreshed: 0, failed: currencies.length };
    }

    const now = new Date();
    let refreshed = 0;
    for (const row of results) {
      const currencyId = codeToId.get(row.code);
      if (!currencyId) continue;
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.rateSnapshot.updateMany({
            where: { currencyId, isCurrent: true },
            data: { isCurrent: false },
          });
          await tx.rateSnapshot.create({
            data: {
              currencyId,
              midRateMru: row.midRateMru.toFixed(8),
              source: this.provider.name,
              fetchedAt: now,
              isCurrent: true,
            },
          });
        });
        refreshed += 1;
      } catch (err) {
        this.logger.error(`snapshot write failed for ${row.code}: ${(err as Error).message}`);
      }
    }
    const failed = currencies.length - refreshed;
    return { refreshed, failed };
  }

  async current(): Promise<CurrentRateRow[]> {
    const rows = await this.prisma.rateSnapshot.findMany({
      where: { isCurrent: true },
      include: { currency: true },
      orderBy: { currency: { code: 'asc' } },
    });
    return rows.map((r) => ({
      currencyId: r.currencyId,
      currencyCode: r.currency.code,
      midRateMru: new Decimal(r.midRateMru.toString()).toFixed(8),
      source: r.source,
      fetchedAt: r.fetchedAt.toISOString(),
    }));
  }

  async history(currencyId: string, limit: number): Promise<RateHistoryRow[]> {
    const rows = await this.prisma.rateSnapshot.findMany({
      where: { currencyId },
      orderBy: { fetchedAt: 'desc' },
      take: limit,
    });
    return rows.map((r) => ({
      id: r.id.toString(),
      midRateMru: new Decimal(r.midRateMru.toString()).toFixed(8),
      source: r.source,
      fetchedAt: r.fetchedAt.toISOString(),
      isCurrent: r.isCurrent,
    }));
  }
}
