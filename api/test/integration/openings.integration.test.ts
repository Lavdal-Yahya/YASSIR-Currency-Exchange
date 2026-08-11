// P3-08 / P3-09 / P3-10 — openings over HTTP.
//
// Exercises:
//   · POST /openings/currency writes opening_balance + ledger CREDIT
//     + cost_movement ACQUISITION + audit;
//   · duplicate opening → 409 OpeningAlreadyExistsError;
//   · POST /openings/debt writes receivable/payable with origin=OPENING
//     and null source, no ledger writes;
//   · go-live lock: POST refused with 422 once go_live_at is set;
//   · PATCH refused with 403 unless caller has
//     opening:adjust_post_golive.
//
// Standing invariants (INV-1/4/6/8/9) verify after every one of these
// tests thanks to the P3-06 afterEach wiring.

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
  PERMISSIONS,
  ROLE_CODES,
} from '../../src/common/permissions.js';
import { setupTestDb } from '../setup.js';
import { Decimal } from '../../src/common/money.js';

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
function nextPhonePair() {
  seq += 1;
  const pad = String(seq).padStart(5, '0');
  return {
    owner: `+2223${pad}`,
    employee: `+2224${pad}`,
    ip: `10.66.${(seq >> 8) & 255}.${seq & 255}`,
  };
}

interface Seed {
  ownerId: string;
  mruId: string;
  usdId: string;
  contactId: string;
  cookie: (phone: string, ip: string) => Promise<string>;
}

async function fullSeed(phones: { owner: string; employee: string }): Promise<Seed> {
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
    const usd = await tx.currency.create({
      data: { code: 'USD', name: 'US Dollar', decimalPlaces: 2 },
    });
    await tx.settings.create({
      data: { id: 1, baseCurrencyId: mru.id, businessTimezone: 'Africa/Nouakchott' },
    });
    const contact = await tx.contact.create({
      data: { name: 'Test Customer', isCustomer: true, isSupplier: false },
    });

    return {
      ownerId: ownerUser.id,
      mruId: mru.id,
      usdId: usd.id,
      contactId: contact.id,
      cookie: (phone: string, ip: string) => loginAndGetCookie(phone, ip),
    };
  });
}

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

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "audit_log",
      "cost_movement",
      "currency_ledger",
      "currency_balance",
      "currency_cost",
      "opening_balance",
      "receivable",
      "payable",
      "user_role",
      "role_permission",
      "settings",
      "currency",
      "contact",
      "payment_method",
      "user",
      "role",
      "permission"
    RESTART IDENTITY CASCADE;
  `);
});

// ---------------------------------------------------------------------------
// P3-08 · opening currency balances
// ---------------------------------------------------------------------------

describe('POST /openings/currency', () => {
  it('rejects unauthenticated → 401', async () => {
    const phones = nextPhonePair();
    await fullSeed(phones);
    await request(app.getHttpServer()).post('/api/v1/openings/currency').send({}).expect(401);
  });

  it('rejects employee (no opening:manage) → 403', async () => {
    const phones = nextPhonePair();
    const seed = await fullSeed(phones);
    const cookie = await seed.cookie(phones.employee, phones.ip);
    await request(app.getHttpServer())
      .post('/api/v1/openings/currency')
      .set('Cookie', cookie)
      .send({
        currencyId: seed.usdId,
        quantity: '10000',
        openingAvgCostMru: '39.00',
        effectiveDate: '2026-08-01',
      })
      .expect(403);
  });

  it('owner creates opening, ledger sum matches quantity (DoD)', async () => {
    const phones = nextPhonePair();
    const seed = await fullSeed(phones);
    const cookie = await seed.cookie(phones.owner, phones.ip);

    const res = await request(app.getHttpServer())
      .post('/api/v1/openings/currency')
      .set('Cookie', cookie)
      .send({
        currencyId: seed.usdId,
        quantity: '10000',
        openingAvgCostMru: '39.00',
        effectiveDate: '2026-08-01',
      })
      .expect(201);

    expect(res.body.currencyId).toBe(seed.usdId);
    expect(res.body.quantity).toBe('10000');

    // Ledger sum matches — this is the exact DoD assertion.
    const ledger = await prisma.$queryRaw<{ sum: string | null }[]>`
      SELECT COALESCE(SUM(CASE WHEN "direction" = 'CREDIT' THEN "amount" ELSE -"amount" END), 0)::text AS sum
      FROM "currency_ledger"
      WHERE "currency_id" = ${seed.usdId}::uuid AND "is_active" = true
    `;
    const ledgerRow = ledger[0];
    if (!ledgerRow) throw new Error('unreachable: ledger sum row missing');
    expect(new Decimal(ledgerRow.sum ?? '0').toString()).toBe('10000');

    // Cost cache matches.
    const cost = await prisma.currencyCost.findUniqueOrThrow({
      where: { currencyId: seed.usdId },
    });
    expect(cost.cachedAvgMru.toString()).toBe('39');
    expect(cost.cachedQuantity.toString()).toBe('10000');

    // Audit row present.
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'opening_balance_created', entityId: res.body.id },
    });
    expect(audit).toBeTruthy();
  });

  it('refuses a second opening for the same currency → 409', async () => {
    const phones = nextPhonePair();
    const seed = await fullSeed(phones);
    const cookie = await seed.cookie(phones.owner, phones.ip);
    const body = {
      currencyId: seed.usdId,
      quantity: '100',
      openingAvgCostMru: '39.00',
      effectiveDate: '2026-08-01',
    };
    await request(app.getHttpServer())
      .post('/api/v1/openings/currency')
      .set('Cookie', cookie)
      .send(body)
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/openings/currency')
      .set('Cookie', cookie)
      .send(body)
      .expect(409);
  });
});

// ---------------------------------------------------------------------------
// P3-09 · opening debts
// ---------------------------------------------------------------------------

describe('POST /openings/debt', () => {
  it('creates an opening receivable with origin=OPENING and no ledger writes', async () => {
    const phones = nextPhonePair();
    const seed = await fullSeed(phones);
    const cookie = await seed.cookie(phones.owner, phones.ip);

    const res = await request(app.getHttpServer())
      .post('/api/v1/openings/debt')
      .set('Cookie', cookie)
      .send({
        contactId: seed.contactId,
        currencyId: seed.usdId,
        amount: '500',
        side: 'receivable',
      })
      .expect(201);

    expect(res.body.side).toBe('receivable');
    expect(res.body.row.origin).toBe('OPENING');
    expect(res.body.row.sourceType).toBeNull();
    expect(res.body.row.sourceId).toBeNull();

    // Debts do not move currency.
    const ledgerRows = await prisma.currencyLedger.count();
    expect(ledgerRows).toBe(0);

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'opening_receivable_created' },
    });
    expect(audit).toBeTruthy();
  });

  it('creates an opening payable', async () => {
    const phones = nextPhonePair();
    const seed = await fullSeed(phones);
    const cookie = await seed.cookie(phones.owner, phones.ip);

    const res = await request(app.getHttpServer())
      .post('/api/v1/openings/debt')
      .set('Cookie', cookie)
      .send({
        contactId: seed.contactId,
        currencyId: seed.usdId,
        amount: '250',
        side: 'payable',
      })
      .expect(201);
    expect(res.body.side).toBe('payable');
    expect(res.body.row.origin).toBe('OPENING');
  });
});

// ---------------------------------------------------------------------------
// P3-10 · go-live lock
// ---------------------------------------------------------------------------

describe('go-live lock', () => {
  it('POST /openings/currency after go-live → 422 opening_after_go_live', async () => {
    const phones = nextPhonePair();
    const seed = await fullSeed(phones);
    const cookie = await seed.cookie(phones.owner, phones.ip);
    await prisma.settings.update({ where: { id: 1 }, data: { goLiveAt: new Date() } });

    const res = await request(app.getHttpServer())
      .post('/api/v1/openings/currency')
      .set('Cookie', cookie)
      .send({
        currencyId: seed.usdId,
        quantity: '100',
        openingAvgCostMru: '39.00',
        effectiveDate: '2026-08-01',
      })
      .expect(422);
    expect(res.body.code).toBe('opening_after_go_live');
  });

  it('POST /openings/debt after go-live → 422', async () => {
    const phones = nextPhonePair();
    const seed = await fullSeed(phones);
    const cookie = await seed.cookie(phones.owner, phones.ip);
    await prisma.settings.update({ where: { id: 1 }, data: { goLiveAt: new Date() } });

    await request(app.getHttpServer())
      .post('/api/v1/openings/debt')
      .set('Cookie', cookie)
      .send({
        contactId: seed.contactId,
        currencyId: seed.usdId,
        amount: '10',
        side: 'receivable',
      })
      .expect(422);
  });

  it('PATCH after go-live: refused without opening:adjust_post_golive', async () => {
    const phones = nextPhonePair();
    const seed = await fullSeed(phones);
    const cookie = await seed.cookie(phones.owner, phones.ip);
    const created = await request(app.getHttpServer())
      .post('/api/v1/openings/currency')
      .set('Cookie', cookie)
      .send({
        currencyId: seed.usdId,
        quantity: '100',
        openingAvgCostMru: '39.00',
        effectiveDate: '2026-08-01',
      })
      .expect(201);

    // Strip the adjust permission from the owner role so the check fires.
    await prisma.rolePermission.deleteMany({
      where: {
        role: { code: ROLE_CODES.OWNER },
        permission: { code: PERMISSIONS.OPENING_ADJUST_POST_GOLIVE },
      },
    });
    await prisma.settings.update({ where: { id: 1 }, data: { goLiveAt: new Date() } });

    await request(app.getHttpServer())
      .patch(`/api/v1/openings/currency/${created.body.id}`)
      .set('Cookie', cookie)
      .send({ effectiveDate: '2026-07-31' })
      .expect(403);
  });

  it('PATCH after go-live: accepted with opening:adjust_post_golive', async () => {
    const phones = nextPhonePair();
    const seed = await fullSeed(phones);
    const cookie = await seed.cookie(phones.owner, phones.ip);
    const created = await request(app.getHttpServer())
      .post('/api/v1/openings/currency')
      .set('Cookie', cookie)
      .send({
        currencyId: seed.usdId,
        quantity: '100',
        openingAvgCostMru: '39.00',
        effectiveDate: '2026-08-01',
      })
      .expect(201);

    await prisma.settings.update({ where: { id: 1 }, data: { goLiveAt: new Date() } });
    // OWNER already has the adjust permission via OWNER_PERMISSIONS.
    await request(app.getHttpServer())
      .patch(`/api/v1/openings/currency/${created.body.id}`)
      .set('Cookie', cookie)
      .send({ effectiveDate: '2026-07-31' })
      .expect(200);

    const updated = await prisma.openingBalance.findUniqueOrThrow({
      where: { id: created.body.id },
    });
    expect(updated.effectiveDate.toISOString().slice(0, 10)).toBe('2026-07-31');
  });
});
