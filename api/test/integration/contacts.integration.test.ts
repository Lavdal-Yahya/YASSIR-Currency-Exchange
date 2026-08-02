// P2-03 · Contact CRUD with duplicate-phone warning.
//
// Covers:
//   - list/get/create/update basics
//   - duplicate-phone returns 409 with the existing row attached, then a
//     retry with confirmDuplicate=true creates a distinct contact (DoD)
//   - customer→also-supplier flip preserves the same row ID + notes (DoD)
//   - archive/unarchive round-trips + hides from default list
//   - DELETE /contacts/:id returns 404 (no route)
//   - contact_role_required fires when both flags are false
//   - the DB CHECK bites when the DTO layer is bypassed

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
    ip: `10.66.${(seq >> 8) & 255}.${seq & 255}`,
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
    'TRUNCATE TABLE "audit_log", "user_role", "role_permission", "user", "role", "permission", "contact" RESTART IDENTITY CASCADE;',
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

describe('POST /contacts', () => {
  it('creates a customer contact and audits it', async () => {
    const phones = nextPhonePair();
    await seedRolesAndUsers(phones);
    const cookie = await loginAndGetCookie(phones.employee, phones.ip);
    const res = await request(app.getHttpServer())
      .post('/api/v1/contacts')
      .set('Cookie', cookie)
      .send({ name: 'Ahmed', phone: '+22233445566', notes: 'régulier' })
      .expect(201);
    expect(res.body).toMatchObject({
      name: 'Ahmed',
      phone: '+22233445566',
      isCustomer: true,
      isSupplier: false,
      isArchived: false,
    });
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'contact_created', entityId: res.body.id },
    });
    expect(audit?.entityType).toBe('contact');
  });

  it('duplicate phone returns 409 with existing row, then confirmDuplicate=true creates a distinct contact', async () => {
    const phones = nextPhonePair();
    await seedRolesAndUsers(phones);
    const cookie = await loginAndGetCookie(phones.employee, phones.ip);
    const first = await request(app.getHttpServer())
      .post('/api/v1/contacts')
      .set('Cookie', cookie)
      .send({ name: 'Fatimetou', phone: '+22240404040' })
      .expect(201);

    const warn = await request(app.getHttpServer())
      .post('/api/v1/contacts')
      .set('Cookie', cookie)
      .send({ name: 'Fatimetou (father)', phone: '+22240404040' })
      .expect(409);
    expect(warn.body.code).toBe('duplicate_phone');
    expect(warn.body.data.existing.id).toBe(first.body.id);

    const proceed = await request(app.getHttpServer())
      .post('/api/v1/contacts')
      .set('Cookie', cookie)
      .send({ name: 'Fatimetou (father)', phone: '+22240404040', confirmDuplicate: true })
      .expect(201);
    expect(proceed.body.id).not.toBe(first.body.id);

    const list = await request(app.getHttpServer())
      .get('/api/v1/contacts')
      .set('Cookie', cookie)
      .expect(200);
    const names = (list.body as Array<{ name: string; phone: string }>)
      .filter((c) => c.phone === '+22240404040')
      .map((c) => c.name)
      .sort();
    expect(names).toEqual(['Fatimetou', 'Fatimetou (father)']);
  });

  it('rejects a contact that is neither customer nor supplier', async () => {
    const phones = nextPhonePair();
    await seedRolesAndUsers(phones);
    const cookie = await loginAndGetCookie(phones.owner, phones.ip);
    const res = await request(app.getHttpServer())
      .post('/api/v1/contacts')
      .set('Cookie', cookie)
      .send({ name: 'Ghost', isCustomer: false, isSupplier: false })
      .expect(422);
    expect(res.body.code).toBe('contact_role_required');
  });

  it('rejects a malformed phone at the DTO layer', async () => {
    const phones = nextPhonePair();
    await seedRolesAndUsers(phones);
    const cookie = await loginAndGetCookie(phones.employee, phones.ip);
    await request(app.getHttpServer())
      .post('/api/v1/contacts')
      .set('Cookie', cookie)
      .send({ name: 'Bad Phone', phone: '123-not-valid' })
      .expect(400);
  });
});

describe('PATCH /contacts/:id', () => {
  it('flipping customer to also-a-supplier preserves the same ID and notes', async () => {
    const phones = nextPhonePair();
    await seedRolesAndUsers(phones);
    const cookie = await loginAndGetCookie(phones.owner, phones.ip);
    const created = await request(app.getHttpServer())
      .post('/api/v1/contacts')
      .set('Cookie', cookie)
      .send({ name: 'Mohamed', phone: '+22250505050', notes: 'famille' })
      .expect(201);

    const updated = await request(app.getHttpServer())
      .patch(`/api/v1/contacts/${created.body.id}`)
      .set('Cookie', cookie)
      .send({ isSupplier: true })
      .expect(200);

    expect(updated.body.id).toBe(created.body.id);
    expect(updated.body.notes).toBe('famille');
    expect(updated.body.isCustomer).toBe(true);
    expect(updated.body.isSupplier).toBe(true);
  });

  it('audit row records only the changed subset', async () => {
    const phones = nextPhonePair();
    await seedRolesAndUsers(phones);
    const cookie = await loginAndGetCookie(phones.owner, phones.ip);
    const created = await request(app.getHttpServer())
      .post('/api/v1/contacts')
      .set('Cookie', cookie)
      .send({ name: 'Salma', phone: '+22261616161' })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/api/v1/contacts/${created.body.id}`)
      .set('Cookie', cookie)
      .send({ notes: "ajouté aujourd'hui" })
      .expect(200);

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'contact_updated', entityId: created.body.id },
    });
    const after = audit?.after as Record<string, unknown> | null;
    expect(after && Object.keys(after)).toEqual(['notes']);
  });
});

describe('POST /contacts/:id/archive', () => {
  it('archive hides from default list; unarchive brings it back', async () => {
    const phones = nextPhonePair();
    await seedRolesAndUsers(phones);
    const cookie = await loginAndGetCookie(phones.owner, phones.ip);
    const created = await request(app.getHttpServer())
      .post('/api/v1/contacts')
      .set('Cookie', cookie)
      .send({ name: 'To Archive', phone: '+22270707070' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/contacts/${created.body.id}/archive`)
      .set('Cookie', cookie)
      .expect(200);

    const listedByDefault = await request(app.getHttpServer())
      .get('/api/v1/contacts')
      .set('Cookie', cookie)
      .expect(200);
    expect(
      (listedByDefault.body as Array<{ id: string }>).some((c) => c.id === created.body.id),
    ).toBe(false);

    const listedWithArchived = await request(app.getHttpServer())
      .get('/api/v1/contacts?includeArchived=true')
      .set('Cookie', cookie)
      .expect(200);
    expect(
      (listedWithArchived.body as Array<{ id: string }>).some((c) => c.id === created.body.id),
    ).toBe(true);

    await request(app.getHttpServer())
      .post(`/api/v1/contacts/${created.body.id}/unarchive`)
      .set('Cookie', cookie)
      .expect(200);
    const afterUnarchive = await request(app.getHttpServer())
      .get('/api/v1/contacts')
      .set('Cookie', cookie)
      .expect(200);
    expect(
      (afterUnarchive.body as Array<{ id: string }>).some((c) => c.id === created.body.id),
    ).toBe(true);
  });
});

describe('DELETE /contacts/:id', () => {
  it('has no route — DELETE returns 404', async () => {
    const phones = nextPhonePair();
    await seedRolesAndUsers(phones);
    const cookie = await loginAndGetCookie(phones.owner, phones.ip);
    const created = await request(app.getHttpServer())
      .post('/api/v1/contacts')
      .set('Cookie', cookie)
      .send({ name: 'No Delete', phone: '+22280808080' })
      .expect(201);
    await request(app.getHttpServer())
      .delete(`/api/v1/contacts/${created.body.id}`)
      .set('Cookie', cookie)
      .expect(404);
  });
});

describe('CHECK constraints', () => {
  it('rejects a row that is neither customer nor supplier when the DTO is bypassed', async () => {
    await expect(
      prisma.contact.create({
        data: { name: 'Ghost', isCustomer: false, isSupplier: false },
      }),
    ).rejects.toThrow();
  });

  it('rejects a malformed phone when the DTO is bypassed', async () => {
    await expect(
      prisma.contact.create({
        data: { name: 'Bad', phone: '123-not-valid' },
      }),
    ).rejects.toThrow();
  });
});

describe('GET /contacts filters', () => {
  it('search matches name (case-insensitive) or phone substring', async () => {
    const phones = nextPhonePair();
    await seedRolesAndUsers(phones);
    const cookie = await loginAndGetCookie(phones.employee, phones.ip);
    await request(app.getHttpServer())
      .post('/api/v1/contacts')
      .set('Cookie', cookie)
      .send({ name: 'Zeinabou', phone: '+22290919293' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/contacts')
      .set('Cookie', cookie)
      .send({ name: 'Cheikh', phone: '+22212345678' })
      .expect(201);

    const byName = await request(app.getHttpServer())
      .get('/api/v1/contacts?search=zein')
      .set('Cookie', cookie)
      .expect(200);
    expect((byName.body as Array<{ name: string }>).map((c) => c.name)).toEqual(['Zeinabou']);

    const byPhone = await request(app.getHttpServer())
      .get('/api/v1/contacts?search=2345')
      .set('Cookie', cookie)
      .expect(200);
    expect((byPhone.body as Array<{ name: string }>).map((c) => c.name)).toEqual(['Cheikh']);
  });
});
