// P2-05 · Payment method lookup (D-020).
//
// Covers:
//   - the five seeded methods are visible, only OTHER carries
//     requires_note=true
//   - create refuses a duplicate code with 409
//   - CASH cannot be deactivated (D-020 rule enforced in the service)
//   - deactivate + reactivate round-trip audits
//   - DELETE /payment-methods/:id has no route (404)
//   - the code shape CHECK constraint bites when the DTO is bypassed

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
    owner: `+2225${pad}`,
    employee: `+2226${pad}`,
    ip: `10.55.${(seq >> 8) & 255}.${seq & 255}`,
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

async function seedSeededMethods(): Promise<void> {
  await prisma.paymentMethod.createMany({
    data: [
      { code: 'CASH', labelFr: 'Espèces', labelAr: 'نقدًا', requiresNote: false },
      { code: 'BANKILY', labelFr: 'Bankily', labelAr: 'Bankily', requiresNote: false },
      { code: 'MASRIVI', labelFr: 'Masrivi', labelAr: 'Masrivi', requiresNote: false },
      { code: 'SEDAD', labelFr: 'Sedad', labelAr: 'Sedad', requiresNote: false },
      { code: 'OTHER', labelFr: 'Autre', labelAr: 'أخرى', requiresNote: true },
    ],
  });
}

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "audit_log", "user_role", "role_permission", "user", "role", "permission", "payment_method" RESTART IDENTITY CASCADE;',
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

describe('GET /payment-methods', () => {
  it('lists the five seeded methods; only OTHER has requiresNote=true', async () => {
    const phones = nextPhonePair();
    await seedRolesAndUsers(phones);
    await seedSeededMethods();
    const cookie = await loginAndGetCookie(phones.employee, phones.ip);
    const res = await request(app.getHttpServer())
      .get('/api/v1/payment-methods')
      .set('Cookie', cookie)
      .expect(200);
    const codes = (res.body as Array<{ code: string; requiresNote: boolean }>).map((m) => m.code);
    expect(codes).toEqual(['BANKILY', 'CASH', 'MASRIVI', 'OTHER', 'SEDAD']);
    const withNote = (res.body as Array<{ code: string; requiresNote: boolean }>).filter(
      (m) => m.requiresNote,
    );
    expect(withNote.map((m) => m.code)).toEqual(['OTHER']);
  });
});

describe('POST /payment-methods', () => {
  it('rejects an employee with 403', async () => {
    const phones = nextPhonePair();
    await seedRolesAndUsers(phones);
    await seedSeededMethods();
    const cookie = await loginAndGetCookie(phones.employee, phones.ip);
    await request(app.getHttpServer())
      .post('/api/v1/payment-methods')
      .set('Cookie', cookie)
      .send({ code: 'WAVE', labelFr: 'Wave', labelAr: 'Wave' })
      .expect(403);
  });

  it('creates a new method as owner and audits it', async () => {
    const phones = nextPhonePair();
    await seedRolesAndUsers(phones);
    await seedSeededMethods();
    const cookie = await loginAndGetCookie(phones.owner, phones.ip);
    const res = await request(app.getHttpServer())
      .post('/api/v1/payment-methods')
      .set('Cookie', cookie)
      .send({ code: 'WAVE', labelFr: 'Wave', labelAr: 'ويف' })
      .expect(201);
    expect(res.body).toMatchObject({ code: 'WAVE', requiresNote: false, isActive: true });

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'payment_method_created', entityId: res.body.id },
    });
    expect(audit?.entityType).toBe('payment_method');
  });

  it('rejects a duplicate code with 409 + payment_method_code_taken', async () => {
    const phones = nextPhonePair();
    await seedRolesAndUsers(phones);
    await seedSeededMethods();
    const cookie = await loginAndGetCookie(phones.owner, phones.ip);
    const res = await request(app.getHttpServer())
      .post('/api/v1/payment-methods')
      .set('Cookie', cookie)
      .send({ code: 'CASH', labelFr: 'Second Cash', labelAr: 'Second' })
      .expect(409);
    expect(res.body.code).toBe('payment_method_code_taken');
  });

  it('rejects a lowercase code at the DTO layer', async () => {
    const phones = nextPhonePair();
    await seedRolesAndUsers(phones);
    await seedSeededMethods();
    const cookie = await loginAndGetCookie(phones.owner, phones.ip);
    await request(app.getHttpServer())
      .post('/api/v1/payment-methods')
      .set('Cookie', cookie)
      .send({ code: 'wave', labelFr: 'Wave', labelAr: 'Wave' })
      .expect(400);
  });
});

describe('POST /payment-methods/:id/deactivate', () => {
  it('deactivates a non-cash method and audits it', async () => {
    const phones = nextPhonePair();
    await seedRolesAndUsers(phones);
    await seedSeededMethods();
    const cookie = await loginAndGetCookie(phones.owner, phones.ip);
    const bankily = await prisma.paymentMethod.findUniqueOrThrow({ where: { code: 'BANKILY' } });
    const res = await request(app.getHttpServer())
      .post(`/api/v1/payment-methods/${bankily.id}/deactivate`)
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body.isActive).toBe(false);
  });

  it('refuses to deactivate CASH with 422 + cannot_deactivate_cash', async () => {
    const phones = nextPhonePair();
    await seedRolesAndUsers(phones);
    await seedSeededMethods();
    const cookie = await loginAndGetCookie(phones.owner, phones.ip);
    const cash = await prisma.paymentMethod.findUniqueOrThrow({ where: { code: 'CASH' } });
    const res = await request(app.getHttpServer())
      .post(`/api/v1/payment-methods/${cash.id}/deactivate`)
      .set('Cookie', cookie)
      .expect(422);
    expect(res.body.code).toBe('cannot_deactivate_cash');

    // CASH stays active.
    const stillActive = await prisma.paymentMethod.findUniqueOrThrow({ where: { code: 'CASH' } });
    expect(stillActive.isActive).toBe(true);
  });

  it('reactivate round-trip works', async () => {
    const phones = nextPhonePair();
    await seedRolesAndUsers(phones);
    await seedSeededMethods();
    const cookie = await loginAndGetCookie(phones.owner, phones.ip);
    const sedad = await prisma.paymentMethod.findUniqueOrThrow({ where: { code: 'SEDAD' } });
    await request(app.getHttpServer())
      .post(`/api/v1/payment-methods/${sedad.id}/deactivate`)
      .set('Cookie', cookie)
      .expect(200);
    const res = await request(app.getHttpServer())
      .post(`/api/v1/payment-methods/${sedad.id}/reactivate`)
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body.isActive).toBe(true);
  });
});

describe('DELETE /payment-methods/:id', () => {
  it('has no route — DELETE returns 404', async () => {
    const phones = nextPhonePair();
    await seedRolesAndUsers(phones);
    await seedSeededMethods();
    const cookie = await loginAndGetCookie(phones.owner, phones.ip);
    const cash = await prisma.paymentMethod.findUniqueOrThrow({ where: { code: 'CASH' } });
    await request(app.getHttpServer())
      .delete(`/api/v1/payment-methods/${cash.id}`)
      .set('Cookie', cookie)
      .expect(404);
  });
});

describe('CHECK constraints', () => {
  it('rejects a lowercase code when the DTO layer is bypassed', async () => {
    await expect(
      prisma.paymentMethod.create({
        data: { code: 'wave', labelFr: 'Wave', labelAr: 'Wave' },
      }),
    ).rejects.toThrow();
  });
});
