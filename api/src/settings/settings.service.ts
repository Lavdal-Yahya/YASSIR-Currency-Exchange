import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Prisma, Settings } from '@prisma/client';
import { AuditService } from '../audit/audit.service.js';
import { setBusinessTimezone } from '../common/period.js';
import { PrismaService } from '../common/prisma.service.js';
import type { UpdateSettingsDto } from './dto/update-settings.dto.js';
import {
  BaseCurrencyInactiveError,
  GoLiveAlreadySetError,
  InvalidTimezoneError,
  SettingsNotInitializedError,
} from './errors.js';

// SettingsService — the singleton row is the source of truth for
// business timezone and base currency. common/period.ts caches the
// timezone via getBusinessTimezone(); the update path invalidates
// that cache.
//
// go-live is a one-way flip. Nothing in v1 clears it — the closest
// analog would be a full re-seed, which is intentional.

const SETTINGS_ID = 1;

@Injectable()
export class SettingsService implements OnModuleInit {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // Populate the period-boundary timezone cache at boot. If the row is
  // missing (fresh DB, not yet seeded) we leave the cache alone — the
  // env var / hard-coded fallback in period.ts covers the gap.
  async onModuleInit(): Promise<void> {
    try {
      const row = await this.prisma.settings.findUnique({ where: { id: SETTINGS_ID } });
      if (row) {
        setBusinessTimezone(row.businessTimezone);
        this.logger.log(`business timezone loaded from settings: ${row.businessTimezone}`);
      }
    } catch (err) {
      // A DB down at boot is a big deal, but not this service's job to
      // surface — Prisma will fail loudly on the first query anyway.
      this.logger.warn(`could not preload settings: ${(err as Error).message}`);
    }
  }

  async get(): Promise<Settings> {
    const found = await this.prisma.settings.findUnique({ where: { id: SETTINGS_ID } });
    if (!found) throw new SettingsNotInitializedError();
    return found;
  }

  async update(actorId: string, dto: UpdateSettingsDto, ip: string | null): Promise<Settings> {
    if (dto.businessTimezone !== undefined) {
      assertValidTimezone(dto.businessTimezone);
    }

    return this.prisma.$transaction(async (tx) => {
      const before = await tx.settings.findUnique({ where: { id: SETTINGS_ID } });
      if (!before) throw new SettingsNotInitializedError();

      if (dto.baseCurrencyId !== undefined && dto.baseCurrencyId !== before.baseCurrencyId) {
        const nextBase = await tx.currency.findUnique({ where: { id: dto.baseCurrencyId } });
        if (!nextBase) {
          throw new BaseCurrencyInactiveError(`(id=${dto.baseCurrencyId})`);
        }
        if (!nextBase.isActive) {
          throw new BaseCurrencyInactiveError(nextBase.code);
        }
      }

      const updated = await tx.settings.update({
        where: { id: SETTINGS_ID },
        data: {
          ...(dto.baseCurrencyId !== undefined ? { baseCurrencyId: dto.baseCurrencyId } : {}),
          ...(dto.businessTimezone !== undefined ? { businessTimezone: dto.businessTimezone } : {}),
          ...(dto.negativeBalanceOverrideAllowed !== undefined
            ? { negativeBalanceOverrideAllowed: dto.negativeBalanceOverrideAllowed }
            : {}),
          updatedByUserId: actorId,
        },
      });

      const diff = diffChanged(serialize(before), serialize(updated));
      if (Object.keys(diff.after).length > 0) {
        await this.audit.log(tx, {
          action: 'settings_updated',
          actorUserId: actorId,
          entityType: 'settings',
          entityId: String(SETTINGS_ID),
          before: diff.before,
          after: diff.after,
          ip,
        });
      }

      // Refresh the period-boundary cache — a tz change takes effect on
      // the next report call without a redeploy.
      setBusinessTimezone(updated.businessTimezone);

      return updated;
    });
  }

  async goLive(actorId: string, ip: string | null): Promise<Settings> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.settings.findUnique({ where: { id: SETTINGS_ID } });
      if (!current) throw new SettingsNotInitializedError();
      if (current.goLiveAt) throw new GoLiveAlreadySetError(current.goLiveAt);

      const now = new Date();
      const updated = await tx.settings.update({
        where: { id: SETTINGS_ID },
        data: { goLiveAt: now, updatedByUserId: actorId },
      });

      await this.audit.log(tx, {
        action: 'settings_went_live',
        actorUserId: actorId,
        entityType: 'settings',
        entityId: String(SETTINGS_ID),
        after: { goLiveAt: now.toISOString() },
        ip,
      });

      return updated;
    });
  }
}

// Intl exposes the tz database; a bad identifier throws RangeError.
function assertValidTimezone(tz: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
  } catch {
    throw new InvalidTimezoneError(tz);
  }
}

function serialize(s: Settings): Prisma.JsonObject {
  return {
    baseCurrencyId: s.baseCurrencyId,
    businessTimezone: s.businessTimezone,
    negativeBalanceOverrideAllowed: s.negativeBalanceOverrideAllowed,
    goLiveAt: s.goLiveAt?.toISOString() ?? null,
  };
}

function diffChanged(
  before: Prisma.JsonObject,
  after: Prisma.JsonObject,
): { before: Prisma.JsonObject; after: Prisma.JsonObject } {
  const b: Prisma.JsonObject = {};
  const a: Prisma.JsonObject = {};
  for (const key of Object.keys(after)) {
    if (before[key] !== after[key]) {
      b[key] = before[key] ?? null;
      a[key] = after[key] ?? null;
    }
  }
  return { before: b, after: a };
}
