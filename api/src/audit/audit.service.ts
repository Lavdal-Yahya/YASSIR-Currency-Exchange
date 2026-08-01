import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service.js';

// The only writer of `audit_log`. Takes a transaction client so the audit
// row shares the transaction of the operation it describes — if the
// operation rolls back, its audit line rolls back with it.
//
// P1-05 uses it for auth events (login/logout/failed login).
// P1-08 will wire the entity-change events (user create/deactivate,
// permission changes). Later phases add currency, contact, settings, etc.
//
// `before`/`after` carry the *changed subset*, not the whole row — a fat
// audit row destroys its own readability (phase-1.md §3).

export interface AuditPayload {
  action: string;
  actorUserId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  before?: Prisma.InputJsonValue | null;
  after?: Prisma.InputJsonValue | null;
  reason?: string | null;
  ip?: string | null;
}

type Tx = Prisma.TransactionClient | PrismaService;

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(tx: Tx | null | undefined, payload: AuditPayload): Promise<void> {
    const client = tx ?? this.prisma;
    await client.auditLog.create({
      data: {
        action: payload.action,
        actorUserId: payload.actorUserId ?? null,
        entityType: payload.entityType ?? null,
        entityId: payload.entityId ?? null,
        before: payload.before ?? undefined,
        after: payload.after ?? undefined,
        reason: payload.reason ?? null,
        ip: payload.ip ?? null,
      },
    });
  }
}
