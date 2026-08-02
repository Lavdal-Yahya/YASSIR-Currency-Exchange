// P2-01 · Currency CRUD over HTTP.
//
// Covers:
//   - permission gating (read vs manage)
//   - create → conflict on duplicate code
//   - update → audit records the diff, not the whole row
//   - deactivate → succeeds in P2 (no usage tables yet), audit row present
//   - reactivate → mirror
//   - DELETE /currencies/:id has no route (404)
//   - CHECK constraints in the migration bite on bad payloads
//
// Each test seeds a distinct owner + employee phone number so the
// login rate limiters (5/min/IP, 10/hr/phone) don't leak counters
// across tests — the throttler lives in-process for the whole suite.

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

let seq = 0;
function nextPhonePair(): { owner: string; employee: string; ip: string } {
  seq += 1;
  const pad = String(seq).padStart(5, '0');
  return {
    owner: `+2221${pad}`,
    employee: `+2222${pad}`,
    // Fresh IP per test keeps us clear of the 5/min/IP limiter too.
    ip: `10.77.${(seq >> 8) & 255}.${seq & 255}`,
  };
}

async function seedRolesAndUsers(phones: { owner: string; employee: string }): Promise<void> {
  const pinHash = await argon2.hash('1234', { type: argon2.argon2id });
  await prisma.$transaction(async (tx) => {
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
      data: { phone: phones.owner, pinHash, fullName: 'Owner' },
    });
    await tx.userRole.create({ data: { userId: ownerUser.id, roleId: owner.id } });
    const employeeUser = await tx.user.create({
      data: { phone: phones.employee, pinHash, fullName: 'Employee' },
    });
    await tx.userRole.create({ data: { userId: employeeUser.id, roleId: employee.id } });
  });
}

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "audit_log", "user_role", "role_permission", "user", "role", "permission", "currency" RESTART IDENTITY CASCADE;',
  );
});

async function loginAndGetCookie(phone: string, ip: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .set('X-Forwarded-For', ip)
    .send({ phone, pin: '1234' })
    .expect(204);
  const setCookie = res.headers['set-cookie'];
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!raw) throw new Error('login did not set a cookie');
  return raw.split(';')[0] ?? '';
}

describe('POST /currencies', () => {
  it('rejects unauthenticated with 401', async () => {
    const phones = nextPhonePair();
    await seedRolesAndUsers(phones);
    await request(app.getHttpServer())
      .post('/api/v1/currencies')
      .send({ code: 'USD', name: 'US Dollar', decimalPlaces: 2 })
      .expect(401);
  });

  it('rejects an employee (no currency:manage) with 403', async () => {
    const phones = nextPhonePair();
    await seedRolesAndUsers(phones);
    const cookie = await loginAndGetCookie(phones.employee, phones.ip);
    await request(app.getHttpServer())
      .post('/api/v1/currencies')
      .set('Cookie', cookie)
      .send({ code: 'USD', name: 'US Dollar', decimalPlaces: 2 })
      .expect(403);
  });

  it('creates as an owner and audits the creation', async () => {
    const phones = nextPhonePair();
    await seedRolesAndUsers(phones);
    const cookie = await loginAndGetCookie(phones.owner, phones.ip);
    const res = await request(app.getHttpServer())
      .post('/api/v1/currencies')
      .set('Cookie', cookie)
      .send({ code: 'USD', name: 'US Dollar', symbol: '$', decimalPlaces: 2 })
      .expect(201);

    expect(res.body).toMatchObject({ code: 'USD', name: 'US Dollar', decimalPlaces: 2 });

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'currency_created', entityId: res.body.id },
    });
    expect(audit?.entityType).toBe('currency');
    expect(audit?.after).toMatchObject({ code: 'USD', decimalPlaces: 2 });
  });

  it('rejects a duplicate code with 409 + currency_code_taken', async () => {
    const phones = nextPhonePair();
    await seedRolesAndUsers(phones);
    const cookie = await loginAndGetCookie(phones.owner, phones.ip);
    await request(app.getHttpServer())
      .post('/api/v1/currencies')
      .set('Cookie', cookie)
      .send({ code: 'USD', name: 'US Dollar', decimalPlaces: 2 })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/api/v1/currencies')
      .set('Cookie', cookie)
      .send({ code: 'USD', name: 'Different name', decimalPlaces: 2 })
      .expect(409);

    expect(res.body.code).toBe('currency_code_taken');
    expect(res.body.i18nKey).toBe('error.currency_code_taken');
  });

  it('rejects an ill-shaped code at the DTO layer with 400 + validation', async () => {
    const phones = nextPhonePair();
    await seedRolesAndUsers(phones);
    const cookie = await loginAndGetCookie(phones.owner, phones.ip);
    const res = await request(app.getHttpServer())
      .post('/api/v1/currencies')
      .set('Cookie', cookie)
      .send({ code: 'us', name: 'US Dollar', decimalPlaces: 2 })
      .expect(400);
    expect(res.body.code).toBe('validation');
  });

  it('rejects decimalPlaces out of the [0,6] range at the DTO layer', async () => {
    const phones = nextPhonePair();
    await seedRolesAndUsers(phones);
    const cookie = await loginAndGetCookie(phones.owner, phones.ip);
    await request(app.getHttpServer())
      .post('/api/v1/currencies')
      .set('Cookie', cookie)
      .send({ code: 'USD', name: 'US Dollar', decimalPlaces: 12 })
      .expect(400);
  });
});

describe('GET /currencies', () => {
  it('lists active currencies for a reader', async () => {
    const phones = nextPhonePair();
    await seedRolesAndUsers(phones);
    const cookie = await loginAndGetCookie(phones.employee, phones.ip);
    await prisma.currency.createMany({
      data: [
        { code: 'MRU', name: 'Ouguiya', decimalPlaces: 2 },
        { code: 'USD', name: 'US Dollar', decimalPlaces: 2 },
        { code: 'EUR', name: 'Euro', decimalPlaces: 2, isActive: false },
      ],
    });
    const res = await request(app.getHttpServer())
      .get('/api/v1/currencies')
      .set('Cookie', cookie)
      .expect(200);
    const codes = (res.body as Array<{ code: string }>).map((c) => c.code);
    expect(codes).toEqual(['MRU', 'USD']);
  });

  it('includes inactive when includeInactive=true', async () => {
    const phones = nextPhonePair();
    await seedRolesAndUsers(phones);
    const cookie = await loginAndGetCookie(phones.employee, phones.ip);
    await prisma.currency.createMany({
      data: [
        { code: 'USD', name: 'US Dollar', decimalPlaces: 2 },
        { code: 'EUR', name: 'Euro', decimalPlaces: 2, isActive: false },
      ],
    });
    const res = await request(app.getHttpServer())
      .get('/api/v1/currencies?includeInactive=true')
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body).toHaveLength(2);
  });
});

describe('PATCH /currencies/:id', () => {
  it('updates name and audits only the changed subset', async () => {
    const phones = nextPhonePair();
    await seedRolesAndUsers(phones);
    const cookie = await loginAndGetCookie(phones.owner, phones.ip);
    const created = await prisma.currency.create({
      data: { code: 'USD', name: 'US Dollar', decimalPlaces: 2 },
    });
    await request(app.getHttpServer())
      .patch(`/api/v1/currencies/${created.id}`)
      .set('Cookie', cookie)
      .send({ name: 'United States Dollar' })
      .expect(200);

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'currency_updated', entityId: created.id },
    });
    expect(audit?.before).toMatchObject({ name: 'US Dollar' });
    expect(audit?.after).toMatchObject({ name: 'United States Dollar' });
    // The changed-subset rule: unchanged fields must not appear.
    expect((audit?.after as Record<string, unknown>).decimalPlaces).toBeUndefined();
  });

  it('returns 404 for a non-existent id', async () => {
    const phones = nextPhonePair();
    await seedRolesAndUsers(phones);
    const cookie = await loginAndGetCookie(phones.owner, phones.ip);
    const missing = '00000000-0000-0000-0000-000000000000';
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/currencies/${missing}`)
      .set('Cookie', cookie)
      .send({ name: 'Nope' })
      .expect(404);
    expect(res.body.code).toBe('currency_not_found');
  });
});

describe('POST /currencies/:id/deactivate + /reactivate', () => {
  it('deactivates in P2 (no usage yet) and audits the flip', async () => {
    const phones = nextPhonePair();
    await seedRolesAndUsers(phones);
    const cookie = await loginAndGetCookie(phones.owner, phones.ip);
    const created = await prisma.currency.create({
      data: { code: 'USD', name: 'US Dollar', decimalPlaces: 2 },
    });

    const res = await request(app.getHttpServer())
      .post(`/api/v1/currencies/${created.id}/deactivate`)
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body.isActive).toBe(false);

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'currency_deactivated', entityId: created.id },
    });
    expect(audit?.before).toMatchObject({ isActive: true });
    expect(audit?.after).toMatchObject({ isActive: false });
  });

  it('is a no-op if already inactive', async () => {
    const phones = nextPhonePair();
    await seedRolesAndUsers(phones);
    const cookie = await loginAndGetCookie(phones.owner, phones.ip);
    const created = await prisma.currency.create({
      data: { code: 'USD', name: 'US Dollar', decimalPlaces: 2, isActive: false },
    });
    await request(app.getHttpServer())
      .post(`/api/v1/currencies/${created.id}/deactivate`)
      .set('Cookie', cookie)
      .expect(200);
    // No new audit row for a no-op.
    const audits = await prisma.auditLog.count({
      where: { action: 'currency_deactivated', entityId: created.id },
    });
    expect(audits).toBe(0);
  });

  it('reactivates and audits the flip', async () => {
    const phones = nextPhonePair();
    await seedRolesAndUsers(phones);
    const cookie = await loginAndGetCookie(phones.owner, phones.ip);
    const created = await prisma.currency.create({
      data: { code: 'USD', name: 'US Dollar', decimalPlaces: 2, isActive: false },
    });
    const res = await request(app.getHttpServer())
      .post(`/api/v1/currencies/${created.id}/reactivate`)
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body.isActive).toBe(true);
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'currency_reactivated', entityId: created.id },
    });
    expect(audit).not.toBeNull();
  });
});

describe('DELETE /currencies/:id', () => {
  it('has no route — DELETE returns 404', async () => {
    const phones = nextPhonePair();
    await seedRolesAndUsers(phones);
    const cookie = await loginAndGetCookie(phones.owner, phones.ip);
    const created = await prisma.currency.create({
      data: { code: 'USD', name: 'US Dollar', decimalPlaces: 2 },
    });
    // 404 not 405 because we never registered a DELETE handler at all —
    // Nest treats an unmatched method+path as not-found. Either is
    // acceptable per phase-2.md §7.
    await request(app.getHttpServer())
      .delete(`/api/v1/currencies/${created.id}`)
      .set('Cookie', cookie)
      .expect(404);
  });
});

describe('CHECK constraints are enforced at the DB', () => {
  it('rejects a lowercase code at the CHECK boundary if the DTO were bypassed', async () => {
    // Bypass the DTO by calling Prisma directly — proves the DB carries
    // its own defense against a wayward inserter.
    await expect(
      prisma.currency.create({
        data: { code: 'usd', name: 'lower', decimalPlaces: 2 },
      }),
    ).rejects.toThrow();
  });

  it('rejects decimal_places=7 at the CHECK boundary', async () => {
    await expect(
      prisma.currency.create({
        data: { code: 'XXX', name: 'x', decimalPlaces: 7 },
      }),
    ).rejects.toThrow();
  });
});
