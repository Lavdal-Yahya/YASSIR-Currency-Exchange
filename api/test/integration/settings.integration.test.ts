// P2-02 · Settings module over HTTP.
//
// Covers:
//   - GET requires settings:read; PATCH requires settings:manage
//   - the single-row CHECK enforces id=1
//   - an unknown IANA timezone is rejected 422 + invalid_timezone
//   - changing the timezone via HTTP updates common/period.ts' cache
//     (a startOfPeriod('month') call shifts accordingly)
//   - go-live is idempotent-refusing: the second call returns 409

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
import { getBusinessTimezone, startOfPeriod } from '../../src/common/period.js';
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
    owner: `+2223${pad}`,
    employee: `+2224${pad}`,
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

async function seedMruAndSettings(): Promise<void> {
  const mru = await prisma.currency.create({
    data: { code: 'MRU', name: 'Ouguiya', decimalPlaces: 2 },
  });
  await prisma.settings.create({
    data: { id: 1, baseCurrencyId: mru.id, businessTimezone: 'Africa/Nouakchott' },
  });
}

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "audit_log", "user_role", "role_permission", "user", "role", "permission", "settings", "currency" RESTART IDENTITY CASCADE;',
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

describe('GET/PATCH /settings', () => {
  it('GET without a cookie → 401; employee (no settings:read) → 403; owner → 200', async () => {
    const phones = nextPhonePair();
    await seedRolesAndUsers(phones);
    await seedMruAndSettings();

    await request(app.getHttpServer()).get('/api/v1/settings').expect(401);

    const empCookie = await loginAndGetCookie(phones.employee, phones.ip);
    await request(app.getHttpServer()).get('/api/v1/settings').set('Cookie', empCookie).expect(403);

    const ownerCookie = await loginAndGetCookie(phones.owner, phones.ip);
    const res = await request(app.getHttpServer())
      .get('/api/v1/settings')
      .set('Cookie', ownerCookie)
      .expect(200);
    expect(res.body.businessTimezone).toBe('Africa/Nouakchott');
    expect(res.body.goLiveAt).toBeNull();
  });

  it('PATCH as employee → 403', async () => {
    const phones = nextPhonePair();
    await seedRolesAndUsers(phones);
    await seedMruAndSettings();
    const cookie = await loginAndGetCookie(phones.employee, phones.ip);
    await request(app.getHttpServer())
      .patch('/api/v1/settings')
      .set('Cookie', cookie)
      .send({ businessTimezone: 'Europe/Paris' })
      .expect(403);
  });

  it('PATCH updates timezone, refreshes period cache, and audits the diff', async () => {
    const phones = nextPhonePair();
    await seedRolesAndUsers(phones);
    await seedMruAndSettings();
    const cookie = await loginAndGetCookie(phones.owner, phones.ip);

    // Before: Africa/Nouakchott (UTC+0 year-round). startOfPeriod
    // returns the UTC instant of local midnight on the 1st, which for
    // UTC+0 is exactly the 1st at 00:00Z.
    expect(startOfPeriod(new Date('2026-03-15T12:00:00Z'), 'month').toISOString()).toBe(
      '2026-03-01T00:00:00.000Z',
    );

    await request(app.getHttpServer())
      .patch('/api/v1/settings')
      .set('Cookie', cookie)
      .send({ businessTimezone: 'Europe/Paris' })
      .expect(200);

    expect(getBusinessTimezone()).toBe('Europe/Paris');

    // Europe/Paris in March is UTC+1 (DST kicks in on the last Sunday);
    // start of month 2026-03-01 local = 2026-02-28 23:00 UTC.
    expect(startOfPeriod(new Date('2026-03-15T12:00:00Z'), 'month').toISOString()).toBe(
      '2026-02-28T23:00:00.000Z',
    );

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'settings_updated' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit?.before).toMatchObject({ businessTimezone: 'Africa/Nouakchott' });
    expect(audit?.after).toMatchObject({ businessTimezone: 'Europe/Paris' });
  });

  it('rejects an unknown IANA timezone with 422 + invalid_timezone', async () => {
    const phones = nextPhonePair();
    await seedRolesAndUsers(phones);
    await seedMruAndSettings();
    const cookie = await loginAndGetCookie(phones.owner, phones.ip);
    const res = await request(app.getHttpServer())
      .patch('/api/v1/settings')
      .set('Cookie', cookie)
      .send({ businessTimezone: 'Not/A_Zone' })
      .expect(422);
    expect(res.body.code).toBe('invalid_timezone');
  });
});

describe('POST /settings/go-live', () => {
  it('sets goLiveAt once and refuses the second call with 409', async () => {
    const phones = nextPhonePair();
    await seedRolesAndUsers(phones);
    await seedMruAndSettings();
    const cookie = await loginAndGetCookie(phones.owner, phones.ip);

    const first = await request(app.getHttpServer())
      .post('/api/v1/settings/go-live')
      .set('Cookie', cookie)
      .expect(200);
    expect(first.body.goLiveAt).toBeTruthy();

    const second = await request(app.getHttpServer())
      .post('/api/v1/settings/go-live')
      .set('Cookie', cookie)
      .expect(409);
    expect(second.body.code).toBe('go_live_already_set');

    const audits = await prisma.auditLog.count({ where: { action: 'settings_went_live' } });
    expect(audits).toBe(1);
  });
});

describe('DB-level guarantees', () => {
  it('the settings_singleton CHECK refuses id=2', async () => {
    await seedMruAndSettings();
    const mru = await prisma.currency.findUniqueOrThrow({ where: { code: 'MRU' } });
    await expect(
      prisma.settings.create({
        data: { id: 2, baseCurrencyId: mru.id, businessTimezone: 'UTC' },
      }),
    ).rejects.toThrow();
  });

  it('the base_currency_id FK enforces referential integrity', async () => {
    await seedMruAndSettings();
    // Cannot repoint at a non-existent currency.
    await expect(
      prisma.settings.update({
        where: { id: 1 },
        data: { baseCurrencyId: '00000000-0000-0000-0000-000000000000' },
      }),
    ).rejects.toThrow();
  });
});
