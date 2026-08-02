import { Injectable } from '@nestjs/common';
import { type Currency, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../common/prisma.service.js';
import type { CreateCurrencyDto } from './dto/create-currency.dto.js';
import type { UpdateCurrencyDto } from './dto/update-currency.dto.js';
import { CurrencyCodeTakenError, CurrencyInUseError, CurrencyNotFoundError } from './errors.js';

// CurrenciesService — metadata-only in P2. `code` is not exposed as
// updateable (see UpdateCurrencyDto). Deactivation counts references
// in "usage tables" — today none exist (ledger arrives in P3), so the
// count is trivially zero. The guard code is here now so P3 flips a
// single boolean rather than restructuring the flow.

interface UsageCounts {
  // Populated from P3 onward. In P2 every count is 0.
  ledgerEntries: number;
  balanceRows: number;
  costMovements: number;
  purchases: number;
  sales: number;
}

// P2 stub — no usage tables exist yet. Extract behind an interface so
// the P3 wiring is a service replacement, not a service edit.
async function usageFor(_tx: Prisma.TransactionClient, _currencyId: string): Promise<UsageCounts> {
  return {
    ledgerEntries: 0,
    balanceRows: 0,
    costMovements: 0,
    purchases: 0,
    sales: 0,
  };
}

@Injectable()
export class CurrenciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(includeInactive = false): Promise<Currency[]> {
    return this.prisma.currency.findMany({
      where: includeInactive ? undefined : { isActive: true },
      orderBy: [{ isActive: 'desc' }, { code: 'asc' }],
    });
  }

  async getById(id: string): Promise<Currency> {
    const found = await this.prisma.currency.findUnique({ where: { id } });
    if (!found) throw new CurrencyNotFoundError(id);
    return found;
  }

  async create(actorId: string, dto: CreateCurrencyDto, ip: string | null): Promise<Currency> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.currency.findUnique({ where: { code: dto.code } });
      if (existing) throw new CurrencyCodeTakenError(dto.code);

      const created = await tx.currency.create({
        data: {
          code: dto.code,
          name: dto.name,
          symbol: dto.symbol ?? null,
          decimalPlaces: dto.decimalPlaces,
          lowBalanceThreshold: dto.lowBalanceThreshold ?? null,
          isActive: dto.isActive ?? true,
        },
      });

      await this.audit.log(tx, {
        action: 'currency_created',
        actorUserId: actorId,
        entityType: 'currency',
        entityId: created.id,
        after: serializeCurrency(created),
        ip,
      });

      return created;
    });
  }

  async update(
    actorId: string,
    id: string,
    dto: UpdateCurrencyDto,
    ip: string | null,
  ): Promise<Currency> {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.currency.findUnique({ where: { id } });
      if (!before) throw new CurrencyNotFoundError(id);

      const updated = await tx.currency.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.symbol !== undefined ? { symbol: dto.symbol } : {}),
          ...(dto.decimalPlaces !== undefined ? { decimalPlaces: dto.decimalPlaces } : {}),
          ...(dto.lowBalanceThreshold !== undefined
            ? { lowBalanceThreshold: dto.lowBalanceThreshold }
            : {}),
        },
      });

      const diff = diffChanged(serializeCurrency(before), serializeCurrency(updated));
      if (Object.keys(diff.after).length > 0) {
        await this.audit.log(tx, {
          action: 'currency_updated',
          actorUserId: actorId,
          entityType: 'currency',
          entityId: id,
          before: diff.before,
          after: diff.after,
          ip,
        });
      }

      return updated;
    });
  }

  async deactivate(actorId: string, id: string, ip: string | null): Promise<Currency> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.currency.findUnique({ where: { id } });
      if (!current) throw new CurrencyNotFoundError(id);
      if (!current.isActive) return current;

      const usage = await usageFor(tx, id);
      const nonZero = Object.entries(usage).filter(([, count]) => count > 0);
      if (nonZero.length > 0) {
        throw new CurrencyInUseError(current.code, Object.fromEntries(nonZero));
      }

      const updated = await tx.currency.update({
        where: { id },
        data: { isActive: false },
      });

      await this.audit.log(tx, {
        action: 'currency_deactivated',
        actorUserId: actorId,
        entityType: 'currency',
        entityId: id,
        before: { isActive: true },
        after: { isActive: false },
        ip,
      });

      return updated;
    });
  }

  async reactivate(actorId: string, id: string, ip: string | null): Promise<Currency> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.currency.findUnique({ where: { id } });
      if (!current) throw new CurrencyNotFoundError(id);
      if (current.isActive) return current;

      const updated = await tx.currency.update({
        where: { id },
        data: { isActive: true },
      });

      await this.audit.log(tx, {
        action: 'currency_reactivated',
        actorUserId: actorId,
        entityType: 'currency',
        entityId: id,
        before: { isActive: false },
        after: { isActive: true },
        ip,
      });

      return updated;
    });
  }
}

// Audit rows carry the changed subset only — a fat row destroys its own
// readability (conventions §3, phase-2.md §3).
// Prisma's InputJsonValue is stricter than Record<string, unknown>; the
// serializer builds an object that satisfies both by using JsonObject.
function serializeCurrency(c: Currency): Prisma.JsonObject {
  return {
    code: c.code,
    name: c.name,
    symbol: c.symbol,
    decimalPlaces: c.decimalPlaces,
    lowBalanceThreshold: c.lowBalanceThreshold?.toString() ?? null,
    isActive: c.isActive,
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
