// End-to-end permission enforcement (phase-1.md §7 DoD):
//   - curl POST /users without a cookie → 401
//   - curl POST /users with an employee cookie (no user:create) → 403
//   - curl POST /users with an owner cookie → 201

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import argon2 from 'argon2';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/bootstrap.js';
import { PrismaService } from '../../src/common/prisma.service.js';
import {
  ALL_PERMISSIONS,
  EMPLOYEE_PERMISSIONS,
  OWNER_PERMISSIONS,
  ROLE_CODES,
} from '../../src/common/permissions.js';
import { setupTestDb } from '../setup.js';

let app: INestApplication;
let prisma: PrismaService;

beforeAll(async () => {
  await setupTestDb();
  app = await NestFactory.create(AppModule, { logger: false });
  configureApp(app);
  await app.init();
  prisma = app.get(PrismaService);
});

afterAll(async () => {
  await app.close();
});

// Seed roles + permissions + one owner + one employee before each test.
async function seedRolesAndUsers(): Promise<{ ownerId: string; employeeId: string }> {
  const pinHash = await argon2.hash('1234', { type: argon2.argon2id });
  return prisma.$transaction(async (tx) => {
    for (const code of ALL_PERMISSIONS) {
      await tx.permission.create({ data: { code } });
    }
    const owner = await tx.role.create({
      data: { code: ROLE_CODES.OWNER, labelFr: 'Propriétaire', labelAr: 'المالك' },
    });
    const employee = await tx.role.create({
      data: { code: ROLE_CODES.EMPLOYEE, labelFr: 'Employé', labelAr: 'موظف' },
    });
    for (const code of OWNER_PERMISSIONS) {
      const p = await tx.permission.findUniqueOrThrow({ where: { code } });
      await tx.rolePermission.create({ data: { roleId: owner.id, permissionId: p.id } });
    }
    for (const code of EMPLOYEE_PERMISSIONS) {
      const p = await tx.permission.findUniqueOrThrow({ where: { code } });
      await tx.rolePermission.create({ data: { roleId: employee.id, permissionId: p.id } });
    }
    const ownerUser = await tx.user.create({
      data: { phone: '+22200000001', pinHash, fullName: 'Owner' },
    });
    await tx.userRole.create({ data: { userId: ownerUser.id, roleId: owner.id } });
    const employeeUser = await tx.user.create({
      data: { phone: '+22200000002', pinHash, fullName: 'Employee' },
    });
    await tx.userRole.create({ data: { userId: employeeUser.id, roleId: employee.id } });

    return { ownerId: ownerUser.id, employeeId: employeeUser.id };
  });
}

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "audit_log", "user_role", "role_permission", "user", "role", "permission" RESTART IDENTITY CASCADE;',
  );
});

async function loginAndGetCookie(phone: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ phone, pin: '1234' })
    .expect(204);
  const setCookie = res.headers['set-cookie'];
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!raw) throw new Error('login did not set a cookie');
  return raw.split(';')[0] ?? '';
}

describe('permission enforcement over HTTP', () => {
  it('POST /users without a cookie → 401', async () => {
    await seedRolesAndUsers();
    await request(app.getHttpServer())
      .post('/api/v1/users')
      .send({ phone: '+22200000099', pin: '1234', fullName: 'X' })
      .expect(401);
  });

  it('POST /users as an employee (no user:create) → 403', async () => {
    await seedRolesAndUsers();
    const cookie = await loginAndGetCookie('+22200000002');
    await request(app.getHttpServer())
      .post('/api/v1/users')
      .set('Cookie', cookie)
      .send({ phone: '+22200000099', pin: '1234', fullName: 'X' })
      .expect(403);
  });

  it('POST /users as an owner → 201 and writes a user.created audit row', async () => {
    const { ownerId } = await seedRolesAndUsers();
    const cookie = await loginAndGetCookie('+22200000001');
    const res = await request(app.getHttpServer())
      .post('/api/v1/users')
      .set('Cookie', cookie)
      .send({ phone: '+22200000099', pin: '1234', fullName: 'New User', roles: ['EMPLOYEE'] })
      .expect(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.phone).toBe('+22200000099');

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'user.created', actorUserId: ownerId },
    });
    expect(audit).not.toBeNull();
    expect(audit?.entityType).toBe('user');
    expect(audit?.entityId).toBe(res.body.id);
  });

  it('POST /users/:id/deactivate as an owner → 204 and audits deactivation', async () => {
    const { ownerId, employeeId } = await seedRolesAndUsers();
    const cookie = await loginAndGetCookie('+22200000001');
    await request(app.getHttpServer())
      .post(`/api/v1/users/${employeeId}/deactivate`)
      .set('Cookie', cookie)
      .expect(204);

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: employeeId } });
    expect(updated.isActive).toBe(false);

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'user.deactivated', actorUserId: ownerId, entityId: employeeId },
    });
    expect(audit).not.toBeNull();
  });

  it('GET /auth/me with @Authenticated returns 401 without cookie and 200 with one', async () => {
    await seedRolesAndUsers();
    await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);

    const cookie = await loginAndGetCookie('+22200000002');
    const res = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body.roles).toEqual(['EMPLOYEE']);
    expect(res.body.permissions).toContain('sale:create');
    expect(res.body.permissions).not.toContain('profit:view');
  });
});
