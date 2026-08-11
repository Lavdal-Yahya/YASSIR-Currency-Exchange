import { Injectable } from '@nestjs/common';
import type { OpeningBalance } from '@prisma/client';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../common/prisma.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import type { CreateOpeningBalanceDto } from './dto/create-opening-balance.dto.js';
import type { UpdateOpeningBalanceDto } from './dto/update-opening-balance.dto.js';
import {
  OpeningAfterGoLiveError,
  OpeningAlreadyExistsError,
  OpeningNotFoundError,
} from './errors.js';
import { CurrencyNotFoundError } from '../currencies/errors.js';

// OpeningBalanceService — writes the first ledger entry a currency
// ever sees.
//
// Contract:
//   1. Refused after go-live (P3-10) — settings.go_live_at is
//      non-null. The check runs first because the ledger write is
//      much more expensive to unwind if refused midway.
//   2. Refused if this currency already has an opening — one per
//      currency (unique index in the migration; caught here for a
//      friendly error).
//   3. Inside a single $transaction:
//        - insert opening_balance row (id known);
//        - hand a CREDIT movement to LedgerService.apply with
//          sourceType='opening_balance' and sourceId = opening.id and
//          unitCostMru = opening_avg_cost_mru;
//        - audit-log with the whole opening_balance shape.
//
// The ledger row's transaction_date is derived from effective_date at
// noon UTC — arbitrary but deterministic, avoids DST boundary edge
// cases, and keeps the row inside the effective_date's day for
// business-tz period reporting.

@Injectable()
export class OpeningBalanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<OpeningBalance[]> {
    return this.prisma.openingBalance.findMany({
      orderBy: { createdAt: 'desc' },
      include: { currency: { select: { code: true, name: true, decimalPlaces: true } } } as never,
    });
  }

  async getById(id: string): Promise<OpeningBalance> {
    const found = await this.prisma.openingBalance.findUnique({
      where: { id },
      include: { currency: { select: { code: true, name: true, decimalPlaces: true } } } as never,
    });
    if (!found) throw new OpeningNotFoundError(id);
    return found;
  }

  async create(
    actorId: string,
    dto: CreateOpeningBalanceDto,
    ip: string | null,
  ): Promise<OpeningBalance> {
    await this.assertPreGoLive();

    return this.prisma.$transaction(async (tx) => {
      const currency = await tx.currency.findUnique({ where: { id: dto.currencyId } });
      if (!currency) throw new CurrencyNotFoundError(dto.currencyId);

      const existing = await tx.openingBalance.findUnique({
        where: { currencyId: dto.currencyId },
      });
      if (existing) throw new OpeningAlreadyExistsError(currency.code);

      const opening = await tx.openingBalance.create({
        data: {
          currencyId: dto.currencyId,
          quantity: dto.quantity,
          openingAvgCostMru: dto.openingAvgCostMru,
          effectiveDate: new Date(dto.effectiveDate),
          createdByUserId: actorId,
        },
      });

      await this.ledger.apply(tx, [
        {
          currencyId: dto.currencyId,
          direction: 'CREDIT',
          amount: dto.quantity,
          sourceType: 'opening_balance',
          sourceId: opening.id,
          transactionDate: new Date(`${dto.effectiveDate.slice(0, 10)}T12:00:00Z`),
          description: `opening balance for ${currency.code}`,
          createdByUserId: actorId,
          unitCostMru: dto.openingAvgCostMru,
        },
      ]);

      await this.audit.log(tx, {
        action: 'opening_balance_created',
        actorUserId: actorId,
        entityType: 'opening_balance',
        entityId: opening.id,
        after: {
          currencyCode: currency.code,
          quantity: opening.quantity.toString(),
          openingAvgCostMru: opening.openingAvgCostMru.toString(),
          effectiveDate: opening.effectiveDate.toISOString().slice(0, 10),
        },
        ip,
      });

      return opening;
    });
  }

  async update(
    actorId: string,
    id: string,
    dto: UpdateOpeningBalanceDto,
    ip: string | null,
  ): Promise<OpeningBalance> {
    // Post-go-live PATCH is refused at the controller unless the caller
    // holds `opening:adjust_post_golive`. Pre-go-live PATCH is free —
    // the ledger row's transaction_date is derived from effective_date
    // at write, so changing effective_date post-facto also updates the
    // ledger row's date to keep them aligned.
    const before = await this.prisma.openingBalance.findUnique({ where: { id } });
    if (!before) throw new OpeningNotFoundError(id);

    if (dto.effectiveDate === undefined) return before;
    const effectiveDate = dto.effectiveDate;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.openingBalance.update({
        where: { id },
        data: { effectiveDate: new Date(effectiveDate) },
      });
      // Keep the ledger row's transaction_date in sync so period reports
      // don't disagree with the opening row.
      await tx.currencyLedger.updateMany({
        where: { sourceType: 'opening_balance', sourceId: id },
        data: { transactionDate: new Date(`${effectiveDate.slice(0, 10)}T12:00:00Z`) },
      });
      await this.audit.log(tx, {
        action: 'opening_balance_updated',
        actorUserId: actorId,
        entityType: 'opening_balance',
        entityId: id,
        before: { effectiveDate: before.effectiveDate.toISOString().slice(0, 10) },
        after: { effectiveDate: updated.effectiveDate.toISOString().slice(0, 10) },
        ip,
      });
      return updated;
    });
  }

  // ---------------------------------------------------------------------------
  // Go-live gate. Called by create() and by the controller before hitting
  // update() (the update caller also needs to check the
  // opening:adjust_post_golive permission separately — see the controller).
  // ---------------------------------------------------------------------------
  async assertPreGoLive(): Promise<void> {
    const settings = await this.prisma.settings.findUnique({ where: { id: 1 } });
    if (settings?.goLiveAt) {
      throw new OpeningAfterGoLiveError({ goLiveAt: settings.goLiveAt.toISOString() });
    }
  }

  async isPostGoLive(): Promise<boolean> {
    const settings = await this.prisma.settings.findUnique({ where: { id: 1 } });
    return Boolean(settings?.goLiveAt);
  }
}
