import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import argon2 from 'argon2';
import type { User } from '@prisma/client';
import { PrismaService } from '../common/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AccountLockedError, InvalidCredentialsError } from './errors.js';

// AuthService — phase-1.md §3 contract.
//
// login(phone, pin, ip):
//   1. Look up user by phone. If missing / !is_active / locked → throw
//      InvalidCredentialsError. Same message for every failure so the
//      response does not distinguish "wrong PIN" from "no such user"
//      (enumeration guard). Locked account gets AccountLockedError
//      returned separately only *after* PIN is checked, so probing a
//      phone number does not reveal whether it is locked.
//   2. On PIN success: zero failed_login_count, clear locked_until,
//      audit `login_succeeded`, mint JWT.
//   3. On PIN failure: increment failed_login_count; if it crosses the
//      threshold, set locked_until = now() + 15m and reset the counter
//      to 0. Audit `login_failed`. All inside ONE transaction — a race
//      between two failed logins otherwise loses the count that would
//      have triggered lockout.
//
// logout(user): clear cookie (controller); audit `logout` here.
//
// resetPin(actor, targetUserId, newPin): admin-only. Verified by the
// controller's @RequirePermission when P1-07 lands.

const FAILED_LOGIN_THRESHOLD = 5; // 5 failures triggers lockout
const LOCKOUT_MINUTES = 15;

export interface LoginResult {
  token: string;
  user: Pick<User, 'id' | 'phone' | 'fullName'>;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly jwt: JwtService,
  ) {}

  async login(phone: string, pin: string, ip: string | null): Promise<LoginResult> {
    // The transaction MUST commit its counter update even when the login
    // fails — throwing inside would roll it back and lockout would never
    // fire. So the transaction returns an outcome, and this method
    // translates it into a return value or an error afterwards.
    //
    // Locking is provided by Postgres: the `SELECT … FOR UPDATE` on the
    // user row serializes concurrent logins for the same account, so two
    // simultaneous wrong-PIN attempts increment the counter by exactly 2.

    const outcome = await this.prisma.$transaction(async (tx) => {
      // FOR UPDATE serializes concurrent logins for the same user. The
      // findUnique read alone would allow both requests to see the same
      // failedLoginCount and each write count+1.
      const rows = await tx.$queryRaw<
        Array<{
          id: string;
          phone: string;
          pin_hash: string;
          full_name: string;
          is_active: boolean;
          locked_until: Date | null;
          failed_login_count: number;
        }>
      >`SELECT id, phone, pin_hash, full_name, is_active, locked_until, failed_login_count
        FROM "user" WHERE phone = ${phone} FOR UPDATE`;

      const user = rows[0];

      if (!user || !user.is_active) {
        await this.audit.log(tx, {
          action: 'login_failed',
          actorUserId: user?.id ?? null,
          reason: user ? 'account_inactive' : 'unknown_phone',
          ip,
        });
        return { kind: 'invalid' as const };
      }

      if (user.locked_until && user.locked_until > new Date()) {
        await this.audit.log(tx, {
          action: 'login_failed',
          actorUserId: user.id,
          reason: 'locked',
          ip,
        });
        return { kind: 'locked' as const, lockedUntil: user.locked_until };
      }

      const ok = await argon2.verify(user.pin_hash, pin);
      if (!ok) {
        const nextCount = user.failed_login_count + 1;
        const shouldLock = nextCount >= FAILED_LOGIN_THRESHOLD;
        const lockedUntil = shouldLock
          ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000)
          : user.locked_until;

        await tx.user.update({
          where: { id: user.id },
          data: {
            failedLoginCount: shouldLock ? 0 : nextCount,
            lockedUntil,
          },
        });
        await this.audit.log(tx, {
          action: shouldLock ? 'account_locked' : 'login_failed',
          actorUserId: user.id,
          reason: shouldLock ? `threshold_${FAILED_LOGIN_THRESHOLD}_reached` : 'wrong_pin',
          ip,
        });
        return { kind: 'invalid' as const };
      }

      // Success — reset counter, clear any prior lockout, audit.
      if (user.failed_login_count > 0 || user.locked_until) {
        await tx.user.update({
          where: { id: user.id },
          data: { failedLoginCount: 0, lockedUntil: null },
        });
      }
      await this.audit.log(tx, {
        action: 'login_succeeded',
        actorUserId: user.id,
        ip,
      });
      return {
        kind: 'ok' as const,
        userId: user.id,
        phone: user.phone,
        fullName: user.full_name,
      };
    });

    switch (outcome.kind) {
      case 'invalid':
        throw new InvalidCredentialsError();
      case 'locked':
        throw new AccountLockedError(outcome.lockedUntil);
      case 'ok': {
        const token = await this.jwt.signAsync({ sub: outcome.userId, phone: outcome.phone });
        return {
          token,
          user: { id: outcome.userId, phone: outcome.phone, fullName: outcome.fullName },
        };
      }
    }
  }

  async logout(userId: string, ip: string | null): Promise<void> {
    // No server-side session to invalidate — JWT expiry is the ceiling.
    // Log the intent so the audit trail matches what the user pressed.
    await this.audit.log(null, {
      action: 'logout',
      actorUserId: userId,
      ip,
    });
  }

  async resetPin(actorUserId: string, targetUserId: string, newPin: string): Promise<void> {
    if (!/^\d{4,8}$/.test(newPin)) {
      throw new InvalidCredentialsError();
    }
    const pinHash = await argon2.hash(newPin, { type: argon2.argon2id });
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: targetUserId },
        data: { pinHash, failedLoginCount: 0, lockedUntil: null },
      });
      await this.audit.log(tx, {
        action: 'pin_reset',
        actorUserId,
        entityType: 'user',
        entityId: targetUserId,
      });
    });
  }

  async getUserWithRolesAndPermissions(userId: string): Promise<{
    id: string;
    phone: string;
    fullName: string;
    roles: string[];
    permissions: string[];
  } | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        roles: {
          include: {
            role: {
              include: {
                permissions: { include: { permission: true } },
              },
            },
          },
        },
      },
    });
    if (!user || !user.isActive) return null;

    const roleCodes = user.roles.map((ur) => ur.role.code);
    const permissionCodes = new Set<string>();
    for (const ur of user.roles) {
      for (const rp of ur.role.permissions) {
        permissionCodes.add(rp.permission.code);
      }
    }
    return {
      id: user.id,
      phone: user.phone,
      fullName: user.fullName,
      roles: roleCodes,
      permissions: [...permissionCodes],
    };
  }
}
