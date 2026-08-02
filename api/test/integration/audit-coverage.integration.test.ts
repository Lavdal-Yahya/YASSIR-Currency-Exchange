// P2-07 · Audit wiring — cross-cutting coverage test.
//
// Every per-feature test already asserts audit rows land for its own
// mutations. This suite is the checklist: it hits every mutation that
// phase-2.md §3 lists as "wired to audit" and confirms an audit row of
// the expected action name appears. If a future refactor drops the
// audit.log() call from a service, this test breaks even if all the
// per-feature tests still pass.
//
// It also enforces the "changed subset only" rule: the after JSON must
// not be the full row — that constraint is proven by counting keys.

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
    ip: `10.99.${(seq >> 8) & 255}.${seq & 255}`,
  };
}

async function seedRolesUsersAndCurrency(phones: {
  owner: string;
  employee: string;
}): Promise<{ ownerId: string; employeeId: string; mruId: string }> {
  const pinHash = await argon2.hash('1234', { type: argon2.argon2id });
  return prisma.$transaction(async (tx) => {
    for (const code of ALL_PERMISSIONS) await tx.permission.create({ data: { code } });
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

    const mru = await tx.currency.create({
      data: { code: 'MRU', name: 'Ouguiya', decimalPlaces: 2 },
    });
    await tx.settings.create({
      data: { id: 1, baseCurrencyId: mru.id, businessTimezone: 'Africa/Nouakchott' },
    });
    await tx.paymentMethod.create({
      data: { code: 'CASH', labelFr: 'Espèces', labelAr: 'نقدًا', requiresNote: false },
    });

    return { ownerId: ownerUser.id, employeeId: employeeUser.id, mruId: mru.id };
  });
}

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "audit_log", "user_role", "role_permission", "user", "role", "permission", "contact", "expense_category", "payment_method", "settings", "currency" RESTART IDENTITY CASCADE;',
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

describe('audit coverage — every phase-2 mutation writes a row', () => {
  it('exercises every mutation action and asserts an audit row lands', async () => {
    const phones = nextPhonePair();
    const { employeeId, mruId } = await seedRolesUsersAndCurrency(phones);
    const cookie = await loginAndGetCookie(phones.owner, phones.ip);

    // Currency create → update → deactivate → reactivate
    const usd = await request(app.getHttpServer())
      .post('/api/v1/currencies')
      .set('Cookie', cookie)
      .send({ code: 'USD', name: 'US Dollar', decimalPlaces: 2 })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/api/v1/currencies/${usd.body.id}`)
      .set('Cookie', cookie)
      .send({ name: 'US Dollar (renamed)' })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/currencies/${usd.body.id}/deactivate`)
      .set('Cookie', cookie)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/currencies/${usd.body.id}/reactivate`)
      .set('Cookie', cookie)
      .expect(200);

    // Contact create → update → archive → unarchive
    const contact = await request(app.getHttpServer())
      .post('/api/v1/contacts')
      .set('Cookie', cookie)
      .send({ name: 'Aïcha', phone: '+22212345678' })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/api/v1/contacts/${contact.body.id}`)
      .set('Cookie', cookie)
      .send({ notes: 'famille' })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/contacts/${contact.body.id}/archive`)
      .set('Cookie', cookie)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/contacts/${contact.body.id}/unarchive`)
      .set('Cookie', cookie)
      .expect(200);

    // Expense category create → update → deactivate → reactivate
    const cat = await request(app.getHttpServer())
      .post('/api/v1/expense-categories')
      .set('Cookie', cookie)
      .send({ name: 'Loyer' })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/api/v1/expense-categories/${cat.body.id}`)
      .set('Cookie', cookie)
      .send({ name: 'Loyer mensuel' })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/expense-categories/${cat.body.id}/deactivate`)
      .set('Cookie', cookie)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/expense-categories/${cat.body.id}/reactivate`)
      .set('Cookie', cookie)
      .expect(200);

    // Payment method create → update → deactivate → reactivate
    const pm = await request(app.getHttpServer())
      .post('/api/v1/payment-methods')
      .set('Cookie', cookie)
      .send({ code: 'WAVE', labelFr: 'Wave', labelAr: 'ويف' })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/api/v1/payment-methods/${pm.body.id}`)
      .set('Cookie', cookie)
      .send({ labelFr: 'Wave (Mauritanie)' })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/payment-methods/${pm.body.id}/deactivate`)
      .set('Cookie', cookie)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/payment-methods/${pm.body.id}/reactivate`)
      .set('Cookie', cookie)
      .expect(200);

    // Settings update
    await request(app.getHttpServer())
      .patch('/api/v1/settings')
      .set('Cookie', cookie)
      .send({ businessTimezone: 'Europe/Paris' })
      .expect(200);

    // User update → deactivate → reactivate → roles → reset-pin
    await request(app.getHttpServer())
      .patch(`/api/v1/users/${employeeId}`)
      .set('Cookie', cookie)
      .send({ fullName: 'Employee Renamed' })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/users/${employeeId}/deactivate`)
      .set('Cookie', cookie)
      .expect(204);
    await request(app.getHttpServer())
      .post(`/api/v1/users/${employeeId}/reactivate`)
      .set('Cookie', cookie)
      .expect(204);
    await request(app.getHttpServer())
      .patch(`/api/v1/users/${employeeId}/roles`)
      .set('Cookie', cookie)
      .send({ roles: ['OWNER', 'EMPLOYEE'] })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/users/${employeeId}/reset-pin`)
      .set('Cookie', cookie)
      .send({ pin: '9999' })
      .expect(204);

    void mruId;

    // The checklist. Every action here must have written at least one
    // audit row over the course of this test.
    const expected = [
      'currency_created',
      'currency_updated',
      'currency_deactivated',
      'currency_reactivated',
      'contact_created',
      'contact_updated',
      'contact_archived',
      'contact_unarchived',
      'expense_category_created',
      'expense_category_updated',
      'expense_category_deactivated',
      'expense_category_reactivated',
      'payment_method_created',
      'payment_method_updated',
      'payment_method_deactivated',
      'payment_method_reactivated',
      'settings_updated',
      'user.updated',
      'user.deactivated',
      'user.reactivated',
      'user.roles_changed',
      'pin_reset',
    ];

    const rows = await prisma.auditLog.findMany({
      where: { action: { in: expected } },
    });
    const seen = new Set(rows.map((r) => r.action));
    const missing = expected.filter((a) => !seen.has(a));
    expect(missing).toEqual([]);
  });

  it('audit rows carry the changed subset, not the full row', async () => {
    const phones = nextPhonePair();
    await seedRolesUsersAndCurrency(phones);
    const cookie = await loginAndGetCookie(phones.owner, phones.ip);

    const created = await request(app.getHttpServer())
      .post('/api/v1/contacts')
      .set('Cookie', cookie)
      .send({ name: 'Only-Notes-Change', phone: '+22299887766' })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/api/v1/contacts/${created.body.id}`)
      .set('Cookie', cookie)
      .send({ notes: 'new note' })
      .expect(200);

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'contact_updated', entityId: created.body.id },
    });
    const after = audit?.after as Record<string, unknown>;
    // Contact has ~7 persistable fields (name, phone, isCustomer,
    // isSupplier, isArchived, notes, timestamps). The changed subset
    // for a note-only PATCH must be 1.
    expect(Object.keys(after)).toHaveLength(1);
    expect(Object.keys(after)).toEqual(['notes']);
  });
});
