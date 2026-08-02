import { Injectable } from '@nestjs/common';
import type { PaymentMethod, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../common/prisma.service.js';
import type { CreatePaymentMethodDto } from './dto/create-payment-method.dto.js';
import type { UpdatePaymentMethodDto } from './dto/update-payment-method.dto.js';
import {
  CannotDeactivateCashError,
  PaymentMethodCodeTakenError,
  PaymentMethodNotFoundError,
} from './errors.js';

// PaymentMethodsService. D-020 rules that bite here:
//   - CASH cannot be deactivated (the till would stop accepting notes).
//   - `code` is immutable once created; renaming would rewrite history.
//   - `requiresNote` is immutable once created; OTHER always requires
//     one, the others never do — flipping this later would silently
//     invalidate old ledger entries written without one.

const CASH_CODE = 'CASH';

@Injectable()
export class PaymentMethodsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(includeInactive = false): Promise<PaymentMethod[]> {
    return this.prisma.paymentMethod.findMany({
      where: includeInactive ? undefined : { isActive: true },
      orderBy: [{ isActive: 'desc' }, { code: 'asc' }],
    });
  }

  async getById(id: string): Promise<PaymentMethod> {
    const found = await this.prisma.paymentMethod.findUnique({ where: { id } });
    if (!found) throw new PaymentMethodNotFoundError(id);
    return found;
  }

  async create(
    actorId: string,
    dto: CreatePaymentMethodDto,
    ip: string | null,
  ): Promise<PaymentMethod> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.paymentMethod.findUnique({ where: { code: dto.code } });
      if (existing) throw new PaymentMethodCodeTakenError(dto.code);

      const created = await tx.paymentMethod.create({
        data: {
          code: dto.code,
          labelFr: dto.labelFr,
          labelAr: dto.labelAr,
          requiresNote: dto.requiresNote ?? false,
        },
      });

      await this.audit.log(tx, {
        action: 'payment_method_created',
        actorUserId: actorId,
        entityType: 'payment_method',
        entityId: created.id,
        after: serialize(created),
        ip,
      });

      return created;
    });
  }

  async update(
    actorId: string,
    id: string,
    dto: UpdatePaymentMethodDto,
    ip: string | null,
  ): Promise<PaymentMethod> {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.paymentMethod.findUnique({ where: { id } });
      if (!before) throw new PaymentMethodNotFoundError(id);

      const updated = await tx.paymentMethod.update({
        where: { id },
        data: {
          ...(dto.labelFr !== undefined ? { labelFr: dto.labelFr } : {}),
          ...(dto.labelAr !== undefined ? { labelAr: dto.labelAr } : {}),
        },
      });

      const diff = diffChanged(serialize(before), serialize(updated));
      if (Object.keys(diff.after).length > 0) {
        await this.audit.log(tx, {
          action: 'payment_method_updated',
          actorUserId: actorId,
          entityType: 'payment_method',
          entityId: id,
          before: diff.before,
          after: diff.after,
          ip,
        });
      }

      return updated;
    });
  }

  async deactivate(actorId: string, id: string, ip: string | null): Promise<PaymentMethod> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.paymentMethod.findUnique({ where: { id } });
      if (!current) throw new PaymentMethodNotFoundError(id);
      if (current.code === CASH_CODE) throw new CannotDeactivateCashError();
      if (!current.isActive) return current;

      const updated = await tx.paymentMethod.update({
        where: { id },
        data: { isActive: false },
      });

      await this.audit.log(tx, {
        action: 'payment_method_deactivated',
        actorUserId: actorId,
        entityType: 'payment_method',
        entityId: id,
        before: { isActive: true },
        after: { isActive: false },
        ip,
      });

      return updated;
    });
  }

  async reactivate(actorId: string, id: string, ip: string | null): Promise<PaymentMethod> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.paymentMethod.findUnique({ where: { id } });
      if (!current) throw new PaymentMethodNotFoundError(id);
      if (current.isActive) return current;

      const updated = await tx.paymentMethod.update({
        where: { id },
        data: { isActive: true },
      });

      await this.audit.log(tx, {
        action: 'payment_method_reactivated',
        actorUserId: actorId,
        entityType: 'payment_method',
        entityId: id,
        before: { isActive: false },
        after: { isActive: true },
        ip,
      });

      return updated;
    });
  }
}

function serialize(m: PaymentMethod): Prisma.JsonObject {
  return {
    code: m.code,
    labelFr: m.labelFr,
    labelAr: m.labelAr,
    isActive: m.isActive,
    requiresNote: m.requiresNote,
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
