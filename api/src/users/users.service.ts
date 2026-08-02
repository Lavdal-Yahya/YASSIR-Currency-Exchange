import { ConflictException, Injectable } from '@nestjs/common';
import argon2 from 'argon2';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { ROLE_CODES } from '../common/permissions.js';
import { CannotDeactivateSelfError, CannotStripOwnRoleError, UserNotFoundError } from './errors.js';

// User management. P1 shipped the minimum needed to prove creation
// and deactivation write audit rows. P2-06 adds:
//   - list + getById with roles
//   - update (fullName only — phone is auth-critical)
//   - reactivate
//   - setRoles (atomic replace)
//
// Self-deactivation and self-owner-strip are refused — an owner locking
// herself out is a rescue-only situation.

interface CreateUserInput {
  phone: string;
  pin: string;
  fullName: string;
  roles: string[];
  isActive: boolean;
  actorUserId: string;
  ip: string | null;
}

export interface UserWithRoles {
  id: string;
  phone: string;
  fullName: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  roles: string[];
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(includeInactive = false): Promise<UserWithRoles[]> {
    const rows = await this.prisma.user.findMany({
      where: includeInactive ? undefined : { isActive: true },
      orderBy: [{ isActive: 'desc' }, { fullName: 'asc' }],
      include: { roles: { include: { role: true } } },
    });
    return rows.map(hydrate);
  }

  async getById(id: string): Promise<UserWithRoles> {
    const row = await this.prisma.user.findUnique({
      where: { id },
      include: { roles: { include: { role: true } } },
    });
    if (!row) throw new UserNotFoundError(id);
    return hydrate(row);
  }

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

  async update(
    actorUserId: string,
    targetUserId: string,
    dto: { fullName?: string },
    ip: string | null,
  ): Promise<UserWithRoles> {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.user.findUnique({
        where: { id: targetUserId },
        include: { roles: { include: { role: true } } },
      });
      if (!before) throw new UserNotFoundError(targetUserId);

      const nextFullName = dto.fullName?.trim();
      if (nextFullName && nextFullName !== before.fullName) {
        await tx.user.update({
          where: { id: targetUserId },
          data: { fullName: nextFullName },
        });
        await this.audit.log(tx, {
          action: 'user.updated',
          actorUserId,
          entityType: 'user',
          entityId: targetUserId,
          before: { fullName: before.fullName },
          after: { fullName: nextFullName },
          ip,
        });
      }

      const row = await tx.user.findUniqueOrThrow({
        where: { id: targetUserId },
        include: { roles: { include: { role: true } } },
      });
      return hydrate(row);
    });
  }

  async deactivate(actorUserId: string, targetUserId: string, ip: string | null): Promise<void> {
    if (actorUserId === targetUserId) throw new CannotDeactivateSelfError();
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.user.findUnique({
        where: { id: targetUserId },
        select: { id: true, isActive: true },
      });
      if (!before) throw new UserNotFoundError(targetUserId);
      if (!before.isActive) return;
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

  async reactivate(actorUserId: string, targetUserId: string, ip: string | null): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.user.findUnique({
        where: { id: targetUserId },
        select: { id: true, isActive: true },
      });
      if (!before) throw new UserNotFoundError(targetUserId);
      if (before.isActive) return;
      await tx.user.update({
        where: { id: targetUserId },
        data: { isActive: true },
      });
      await this.audit.log(tx, {
        action: 'user.reactivated',
        actorUserId,
        entityType: 'user',
        entityId: targetUserId,
        before: { isActive: false },
        after: { isActive: true },
        ip,
      });
    });
  }

  async setRoles(
    actorUserId: string,
    targetUserId: string,
    roleCodes: string[],
    ip: string | null,
  ): Promise<UserWithRoles> {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.user.findUnique({
        where: { id: targetUserId },
        include: { roles: { include: { role: true } } },
      });
      if (!before) throw new UserNotFoundError(targetUserId);

      if (
        actorUserId === targetUserId &&
        before.roles.some((r) => r.role.code === ROLE_CODES.OWNER) &&
        !roleCodes.includes(ROLE_CODES.OWNER)
      ) {
        throw new CannotStripOwnRoleError();
      }

      const targetRoles =
        roleCodes.length > 0 ? await tx.role.findMany({ where: { code: { in: roleCodes } } }) : [];
      if (targetRoles.length !== roleCodes.length) {
        throw new ConflictException({ code: 'unknown_role', i18nKey: 'error.unknown_role' });
      }

      const beforeCodes = before.roles.map((r) => r.role.code).sort();
      const afterCodes = [...roleCodes].sort();
      const changed =
        beforeCodes.length !== afterCodes.length || beforeCodes.some((c, i) => c !== afterCodes[i]);

      if (changed) {
        await tx.userRole.deleteMany({ where: { userId: targetUserId } });
        for (const role of targetRoles) {
          await tx.userRole.create({ data: { userId: targetUserId, roleId: role.id } });
        }
        await this.audit.log(tx, {
          action: 'user.roles_changed',
          actorUserId,
          entityType: 'user',
          entityId: targetUserId,
          before: { roles: beforeCodes as Prisma.JsonArray },
          after: { roles: afterCodes as Prisma.JsonArray },
          ip,
        });
      }

      const row = await tx.user.findUniqueOrThrow({
        where: { id: targetUserId },
        include: { roles: { include: { role: true } } },
      });
      return hydrate(row);
    });
  }
}

type UserRow = Prisma.UserGetPayload<{ include: { roles: { include: { role: true } } } }>;

function hydrate(u: UserRow): UserWithRoles {
  return {
    id: u.id,
    phone: u.phone,
    fullName: u.fullName,
    isActive: u.isActive,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
    roles: u.roles.map((r) => r.role.code).sort(),
  };
}
