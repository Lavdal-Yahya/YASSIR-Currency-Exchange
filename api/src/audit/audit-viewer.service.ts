import { Injectable } from '@nestjs/common';
import type { AuditLog } from '@prisma/client';
import { PrismaService } from '../common/prisma.service.js';
import type { Paginated } from '../trades/trade-read.service.js';
import type { ListAuditQueryDto } from './dto/list-audit.dto.js';

// AuditViewerService — read-only. Owner-only permission enforced at
// the controller. Returns audit_log rows with the actor's phone/name
// joined for display; before/after JSON is passed through untouched.

export interface AuditLogRow extends AuditLog {
  actorPhone: string | null;
  actorName: string | null;
}

@Injectable()
export class AuditViewerService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListAuditQueryDto): Promise<Paginated<AuditLogRow>> {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    const where = {
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            createdAt: {
              ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
              ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
            },
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        include: { actor: { select: { phone: true, fullName: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    const data = rows.map<AuditLogRow>((r) => {
      const { actor, ...rest } = r;
      return {
        ...rest,
        actorPhone: actor?.phone ?? null,
        actorName: actor?.fullName ?? null,
      };
    });
    return { data, total };
  }
}
