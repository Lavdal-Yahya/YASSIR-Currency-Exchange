// Integration tests for AuthService. Real Postgres, real $transaction.
//
// Priority ordering follows phase-1.md §6 — concurrency first, because
// concurrency tests are the ones people skip when the sprint tightens.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import argon2 from 'argon2';
import { JwtService } from '@nestjs/jwt';
import type { PrismaClient } from '@prisma/client';
import { AuthService } from '../../src/auth/auth.service.js';
import { AuditService } from '../../src/audit/audit.service.js';
import { type PrismaService } from '../../src/common/prisma.service.js';
import { setupTestDb, truncateAuthTables } from '../setup.js';

const PIN = '1234';
const WRONG_PIN = '9999';
const PHONE = '+22200000001';

// Direct instantiation — no Nest DI. esbuild (vitest's transformer) does
// not emit the decorator metadata Nest needs to resolve constructor deps
// at runtime, and dragging in a SWC transformer for a test suite is more
// weight than the wiring it saves.
function makeService(prisma: PrismaClient): AuthService {
  const audit = new AuditService(prisma as unknown as PrismaService);
  const jwt = new JwtService({
    secret: 'test-secret-'.padEnd(48, 'x'),
    signOptions: { expiresIn: '1h' },
  });
  return new AuthService(prisma as unknown as PrismaService, audit, jwt);
}

async function createUser(prisma: PrismaClient, phone = PHONE): Promise<string> {
  const pinHash = await argon2.hash(PIN, { type: argon2.argon2id });
  const user = await prisma.user.create({
    data: { phone, pinHash, fullName: 'Test User' },
  });
  return user.id;
}

let prisma: PrismaClient;
let auth: AuthService;

beforeAll(async () => {
  ({ prisma } = await setupTestDb());
  auth = makeService(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await truncateAuthTables(prisma);
});

describe('AuthService.login', () => {
  it('argon2 verify round-trip', async () => {
    await createUser(prisma);
    const { token } = await auth.login(PHONE, PIN, null);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

    await expect(auth.login(PHONE, WRONG_PIN, null)).rejects.toMatchObject({
      status: 401,
    });
  });

  it('increments failed_login_count on wrong PIN and audits it', async () => {
    const userId = await createUser(prisma);
    await expect(auth.login(PHONE, WRONG_PIN, '10.0.0.1')).rejects.toBeDefined();

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.failedLoginCount).toBe(1);
    expect(user.lockedUntil).toBeNull();

    const audit = await prisma.auditLog.findMany({ where: { actorUserId: userId } });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.action).toBe('login_failed');
    expect(audit[0]?.ip).toBe('10.0.0.1');
  });

  it('locks the account after threshold and refuses subsequent logins', async () => {
    const userId = await createUser(prisma);

    for (let i = 0; i < 5; i++) {
      await expect(auth.login(PHONE, WRONG_PIN, null)).rejects.toBeDefined();
    }

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.failedLoginCount).toBe(0); // reset after lockout is triggered
    expect(user.lockedUntil).not.toBeNull();
    expect(user.lockedUntil?.getTime() ?? 0).toBeGreaterThan(Date.now());

    // Even the correct PIN is refused while locked
    const err = await auth.login(PHONE, PIN, null).catch((e) => e);
    expect(err.getStatus()).toBe(401);
    expect(err.getResponse().code).toBe('account_locked');

    const actions = (await prisma.auditLog.findMany({ where: { actorUserId: userId } })).map(
      (r) => r.action,
    );
    expect(actions).toContain('account_locked');
    expect(actions.filter((a) => a === 'login_failed').length).toBeGreaterThanOrEqual(4);
  });

  it('concurrent failed logins increment the counter by 2 (not 1)', async () => {
    // The core concurrency guarantee. Serialization is provided by
    // Postgres's row-lock; if AuthService.login skipped $transaction or
    // used a stale read, only one increment would land and lockout would
    // never fire.
    const userId = await createUser(prisma);

    const results = await Promise.allSettled([
      auth.login(PHONE, WRONG_PIN, null),
      auth.login(PHONE, WRONG_PIN, null),
    ]);
    expect(results.every((r) => r.status === 'rejected')).toBe(true);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.failedLoginCount).toBe(2);
  });

  it('resets failed_login_count and lockedUntil on successful login', async () => {
    const userId = await createUser(prisma);
    await expect(auth.login(PHONE, WRONG_PIN, null)).rejects.toBeDefined();
    await expect(auth.login(PHONE, WRONG_PIN, null)).rejects.toBeDefined();
    let user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.failedLoginCount).toBe(2);

    await auth.login(PHONE, PIN, null);
    user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.failedLoginCount).toBe(0);
    expect(user.lockedUntil).toBeNull();
  });

  it('same error message for unknown phone as for wrong PIN (no enumeration)', async () => {
    await createUser(prisma);

    const unknown = await auth.login('+22299999999', PIN, null).catch((e) => e);
    const wrong = await auth.login(PHONE, WRONG_PIN, null).catch((e) => e);
    expect(unknown.getStatus()).toBe(wrong.getStatus());
    expect(unknown.getResponse().code).toBe(wrong.getResponse().code);
    expect(unknown.getResponse().message).toBe(wrong.getResponse().message);
  });

  it('refuses an inactive user with the same error as unknown phone', async () => {
    const userId = await createUser(prisma);
    await prisma.user.update({ where: { id: userId }, data: { isActive: false } });

    const err = await auth.login(PHONE, PIN, null).catch((e) => e);
    expect(err.getStatus()).toBe(401);
    expect(err.getResponse().code).toBe('invalid_credentials');
  });
});

describe('AuthService.logout', () => {
  it('writes a logout audit row', async () => {
    const userId = await createUser(prisma);
    await auth.logout(userId, '10.0.0.2');
    const rows = await prisma.auditLog.findMany({ where: { actorUserId: userId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe('logout');
    expect(rows[0]?.ip).toBe('10.0.0.2');
  });
});

describe('AuthService.resetPin', () => {
  it('rehashes, clears lockout, and audits with entity ref', async () => {
    const actorId = await createUser(prisma, '+22200000010');
    const targetId = await createUser(prisma, '+22200000011');

    // Lock target first
    for (let i = 0; i < 5; i++) {
      await auth.login('+22200000011', WRONG_PIN, null).catch(() => undefined);
    }

    await auth.resetPin(actorId, targetId, '5678');

    const target = await prisma.user.findUniqueOrThrow({ where: { id: targetId } });
    expect(target.lockedUntil).toBeNull();
    expect(target.failedLoginCount).toBe(0);
    expect(await argon2.verify(target.pinHash, '5678')).toBe(true);

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'pin_reset', actorUserId: actorId },
    });
    expect(audit).not.toBeNull();
    expect(audit?.entityType).toBe('user');
    expect(audit?.entityId).toBe(targetId);
  });

  it('rejects a PIN with the wrong shape', async () => {
    const actorId = await createUser(prisma);
    await expect(auth.resetPin(actorId, actorId, 'abc')).rejects.toBeDefined();
    await expect(auth.resetPin(actorId, actorId, '12')).rejects.toBeDefined();
  });
});
