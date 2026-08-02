// P2-04 · Expense category lookup CRUD.
//
// Covers:
//   - list/create/rename with audit
//   - duplicate name → 409 + expense_category_name_taken
//   - deactivate + reactivate round-trip
//   - employee (no expense_category:manage) is refused on POST
//   - DELETE /:id returns 404 (no route)
//   - the DB CHECK bites when the DTO is bypassed (empty/blank name)

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
    'TRUNCATE TABLE "audit_log", "user_role", "role_permission", "user", "role", "permission", "expense_category" RESTART IDENTITY CASCADE;',
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

describe('POST /expense-categories', () => {
  it('owner creates a category and it is audited', async () => {
    const phones = nextPhonePair();
    await seedRolesAndUsers(phones);
    const cookie = await loginAndGetCookie(phones.owner, phones.ip);
    const res = await request(app.getHttpServer())
      .post('/api/v1/expense-categories')
      .set('Cookie', cookie)
      .send({ name: 'Loyer' })
      .expect(201);
    expect(res.body).toMatchObject({ name: 'Loyer', isActive: true });

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'expense_category_created', entityId: res.body.id },
    });
    expect(audit?.entityType).toBe('expense_category');
  });

  it('employee attempt is refused with 403', async () => {
    const phones = nextPhonePair();
    await seedRolesAndUsers(phones);
    const cookie = await loginAndGetCookie(phones.employee, phones.ip);
    await request(app.getHttpServer())
      .post('/api/v1/expense-categories')
      .set('Cookie', cookie)
      .send({ name: 'Internet' })
      .expect(403);
  });

  it('duplicate name → 409 with expense_category_name_taken', async () => {
    const phones = nextPhonePair();
    await seedRolesAndUsers(phones);
    const cookie = await loginAndGetCookie(phones.owner, phones.ip);
    await request(app.getHttpServer())
      .post('/api/v1/expense-categories')
      .set('Cookie', cookie)
      .send({ name: 'Salaires' })
      .expect(201);
    const res = await request(app.getHttpServer())
      .post('/api/v1/expense-categories')
      .set('Cookie', cookie)
      .send({ name: 'Salaires' })
      .expect(409);
    expect(res.body.code).toBe('expense_category_name_taken');
  });
});

describe('PATCH /expense-categories/:id', () => {
  it('rename works and audits the diff', async () => {
    const phones = nextPhonePair();
    await seedRolesAndUsers(phones);
    const cookie = await loginAndGetCookie(phones.owner, phones.ip);
    const created = await request(app.getHttpServer())
      .post('/api/v1/expense-categories')
      .set('Cookie', cookie)
      .send({ name: 'Elec' })
      .expect(201);
    const renamed = await request(app.getHttpServer())
      .patch(`/api/v1/expense-categories/${created.body.id}`)
      .set('Cookie', cookie)
      .send({ name: 'Électricité' })
      .expect(200);
    expect(renamed.body.name).toBe('Électricité');

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'expense_category_updated', entityId: created.body.id },
    });
    expect(audit?.after).toEqual({ name: 'Électricité' });
    expect(audit?.before).toEqual({ name: 'Elec' });
  });

  it('rename to an existing name → 409', async () => {
    const phones = nextPhonePair();
    await seedRolesAndUsers(phones);
    const cookie = await loginAndGetCookie(phones.owner, phones.ip);
    await request(app.getHttpServer())
      .post('/api/v1/expense-categories')
      .set('Cookie', cookie)
      .send({ name: 'Loyer' })
      .expect(201);
    const other = await request(app.getHttpServer())
      .post('/api/v1/expense-categories')
      .set('Cookie', cookie)
      .send({ name: 'Autre' })
      .expect(201);
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/expense-categories/${other.body.id}`)
      .set('Cookie', cookie)
      .send({ name: 'Loyer' })
      .expect(409);
    expect(res.body.code).toBe('expense_category_name_taken');
  });
});

describe('POST /expense-categories/:id/deactivate', () => {
  it('deactivate then reactivate round-trip', async () => {
    const phones = nextPhonePair();
    await seedRolesAndUsers(phones);
    const cookie = await loginAndGetCookie(phones.owner, phones.ip);
    const created = await request(app.getHttpServer())
      .post('/api/v1/expense-categories')
      .set('Cookie', cookie)
      .send({ name: 'Divers' })
      .expect(201);

    const deactivated = await request(app.getHttpServer())
      .post(`/api/v1/expense-categories/${created.body.id}/deactivate`)
      .set('Cookie', cookie)
      .expect(200);
    expect(deactivated.body.isActive).toBe(false);

    const activeList = await request(app.getHttpServer())
      .get('/api/v1/expense-categories')
      .set('Cookie', cookie)
      .expect(200);
    expect((activeList.body as Array<{ id: string }>).some((c) => c.id === created.body.id)).toBe(
      false,
    );

    const inclList = await request(app.getHttpServer())
      .get('/api/v1/expense-categories?includeInactive=true')
      .set('Cookie', cookie)
      .expect(200);
    expect((inclList.body as Array<{ id: string }>).some((c) => c.id === created.body.id)).toBe(
      true,
    );

    const reactivated = await request(app.getHttpServer())
      .post(`/api/v1/expense-categories/${created.body.id}/reactivate`)
      .set('Cookie', cookie)
      .expect(200);
    expect(reactivated.body.isActive).toBe(true);
  });
});

describe('DELETE /expense-categories/:id', () => {
  it('has no route — DELETE returns 404', async () => {
    const phones = nextPhonePair();
    await seedRolesAndUsers(phones);
    const cookie = await loginAndGetCookie(phones.owner, phones.ip);
    const created = await request(app.getHttpServer())
      .post('/api/v1/expense-categories')
      .set('Cookie', cookie)
      .send({ name: 'Nope' })
      .expect(201);
    await request(app.getHttpServer())
      .delete(`/api/v1/expense-categories/${created.body.id}`)
      .set('Cookie', cookie)
      .expect(404);
  });
});

describe('CHECK constraints', () => {
  it('rejects a blank name when the DTO is bypassed', async () => {
    await expect(prisma.expenseCategory.create({ data: { name: '   ' } })).rejects.toThrow();
  });
});
