import { ConflictException, Injectable } from '@nestjs/common';
import argon2 from 'argon2';
import { PrismaService } from '../common/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { ROLE_CODES } from '../common/permissions.js';

// User management. P1 ships the minimum needed to prove:
//   - create → audit row
//   - deactivate → audit row
//   - reset PIN → audit row (in AuthService)
//
// P2-06 extends this with the full admin surface (list, edit,
// role assignment as its own operation, etc.).

interface CreateUserInput {
  phone: string;
  pin: string;
  fullName: string;
  roles: string[];
  isActive: boolean;
  actorUserId: string;
  ip: string | null;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(input: CreateUserInput): Promise<{ id: string; phone: string }> {
    const pinHash = await argon2.hash(input.pin, { type: argon2.argon2id });

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { phone: input.phone } });
      if (existing)
        throw new ConflictException({ code: 'phone_taken', i18nKey: 'error.phone_taken' });

      const roleCodes = input.roles.length > 0 ? input.roles : [ROLE_CODES.EMPLOYEE];
      const roles = await tx.role.findMany({ where: { code: { in: roleCodes } } });
      if (roles.length !== roleCodes.length) {
        throw new ConflictException({ code: 'unknown_role', i18nKey: 'error.unknown_role' });
      }

      const user = await tx.user.create({
        data: {
          phone: input.phone,
          pinHash,
          fullName: input.fullName,
          isActive: input.isActive,
        },
      });
      for (const role of roles) {
        await tx.userRole.create({ data: { userId: user.id, roleId: role.id } });
      }

      await this.audit.log(tx, {
        action: 'user.created',
        actorUserId: input.actorUserId,
        entityType: 'user',
        entityId: user.id,
        after: {
          phone: user.phone,
          fullName: user.fullName,
          isActive: user.isActive,
          roles: roleCodes,
        },
        ip: input.ip,
      });

      return { id: user.id, phone: user.phone };
    });
  }

  async deactivate(actorUserId: string, targetUserId: string, ip: string | null): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.user.findUnique({
        where: { id: targetUserId },
        select: { id: true, isActive: true },
      });
      if (!before) return;
      await tx.user.update({
        where: { id: targetUserId },
        data: { isActive: false },
      });
      await this.audit.log(tx, {
        action: 'user.deactivated',
        actorUserId,
        entityType: 'user',
        entityId: targetUserId,
        before: { isActive: before.isActive },
        after: { isActive: false },
        ip,
      });
    });
  }
}
