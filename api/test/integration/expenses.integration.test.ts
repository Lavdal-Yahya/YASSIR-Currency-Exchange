// P5-06 · Expense creation integration tests.
//
// §6.7 — balance exceeded → 422 insufficient_balance
// §6.8 — requires_note payment method with empty note → 422 method_note_required
//        Inactive category → 422 inactive_expense_category
//        DELETE /expenses/:id is absent → 404
//        List endpoint smoke test

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import argon2 from 'argon2';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/bootstrap.js';
import { PrismaService } from '../../src/common/prisma.service.js';
import { ALL_PERMISSIONS, OWNER_PERMISSIONS, ROLE_CODES } from '../../src/common/permissions.js';
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
function nextPhone() {
  seq += 1;
  return {
    owner: `+2228${String(seq).padStart(5, '0')}`,
    ip: `10.77.${(seq >> 8) & 255}.${seq & 255}`,
  };
}

interface Seed {
  ownerId: string;
  mruId: string;
  cashMethodId: string;
  noteMethodId: string;
  categoryId: string;
  ownerCookie: string;
}

async function fullSeed(phones: { owner: string; ip: string }): Promise<Seed> {
  const pinHash = await argon2.hash('1234', { type: argon2.argon2id });
  const ids = await prisma.$transaction(async (tx) => {
    for (const code of ALL_PERMISSIONS) await tx.permission.create({ data: { code } });
    const ownerRole = await tx.role.create({
      data: { code: ROLE_CODES.OWNER, labelFr: 'Propriétaire', labelAr: 'المالك' },
    });
    for (const code of OWNER_PERMISSIONS) {
      const p = await tx.permission.findUniqueOrThrow({ where: { code } });
      await tx.rolePermission.create({ data: { roleId: ownerRole.id, permissionId: p.id } });
    }
    const owner = await tx.user.create({
      data: { phone: phones.owner, pinHash, fullName: 'Owner' },
    });
    await tx.userRole.create({ data: { userId: owner.id, roleId: ownerRole.id } });

    const mru = await tx.currency.create({
      data: { code: 'MRU', name: 'Ouguiya', decimalPlaces: 2 },
    });
    await tx.settings.create({
      data: { id: 1, baseCurrencyId: mru.id, businessTimezone: 'Africa/Nouakchott' },
    });

    const cash = await tx.paymentMethod.create({
      data: { code: 'CASH', labelFr: 'Espèces', labelAr: 'نقداً', requiresNote: false },
    });
    const noteMethod = await tx.paymentMethod.create({
      data: { code: 'WIRE', labelFr: 'Virement', labelAr: 'تحويل', requiresNote: true },
    });
    const category = await tx.expenseCategory.create({
      data: { name: 'Rent', isActive: true },
    });
    return {
      ownerId: owner.id,
      mruId: mru.id,
      cashMethodId: cash.id,
      noteMethodId: noteMethod.id,
      categoryId: category.id,
    };
  });

  const loginRes = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .set('X-Forwarded-For', phones.ip)
    .send({ phone: phones.owner, pin: '1234' })
    .expect(204);
  const raw = Array.isArray(loginRes.headers['set-cookie'])
    ? loginRes.headers['set-cookie'][0]
    : loginRes.headers['set-cookie'];
  const ownerCookie = (raw as string).split(';')[0] ?? '';

  return { ...ids, ownerCookie };
}

/** Open an MRU balance by posting an opening. */
async function openMru(seed: Seed, amount: string): Promise<void> {
  await request(app.getHttpServer())
    .post('/api/v1/openings/currency')
    .set('Cookie', seed.ownerCookie)
    .send({
      currencyId: seed.mruId,
      quantity: amount,
      openingAvgCostMru: '1',
      effectiveDate: '2026-08-01',
    })
    .expect(201);
}

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "audit_log",
      "expense",
      "cost_movement",
      "currency_ledger",
      "currency_balance",
      "currency_cost",
      "opening_balance",
      "user_role",
      "role_permission",
      "expense_category",
      "payment_method",
      "settings",
      "currency",
      "user",
      "role",
      "permission"
    RESTART IDENTITY CASCADE;
  `);
});

// ---------------------------------------------------------------------------
// §6.7 — Successful expense creation and list smoke test
// ---------------------------------------------------------------------------

describe('POST /expenses — successful creation', () => {
  it('creates an MRU expense, debits the ledger, and returns the expense row', async () => {
    const phones = nextPhone();
    const seed = await fullSeed(phones);
    await openMru(seed, '5000');

    const res = await request(app.getHttpServer())
      .post('/api/v1/expenses')
      .set('Cookie', seed.ownerCookie)
      .send({
        expenseCategoryId: seed.categoryId,
        currencyId: seed.mruId,
        amount: '1000',
        paymentMethodId: seed.cashMethodId,
        description: 'Monthly office rent',
      })
      .expect(201);

    expect(res.body.id).toBeTruthy();
    expect(res.body.status).toBe('CONFIRMED');

    // Ledger DEBIT should reduce the balance
    const balance = await prisma.currencyBalance.findUnique({
      where: { currencyId: seed.mruId },
    });
    expect(Number(balance?.cachedAmount)).toBe(4000);

    // Audit row
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'expense_created', entityId: res.body.id },
    });
    expect(audit).toBeTruthy();
    expect((audit!.after as Record<string, unknown>).amount).toBe('1000');
  });
});

// ---------------------------------------------------------------------------
// List and get-by-id smoke tests
// ---------------------------------------------------------------------------

describe('GET /expenses', () => {
  it('returns paginated list of expenses', async () => {
    const phones = nextPhone();
    const seed = await fullSeed(phones);
    await openMru(seed, '10000');

    await request(app.getHttpServer())
      .post('/api/v1/expenses')
      .set('Cookie', seed.ownerCookie)
      .send({
        expenseCategoryId: seed.categoryId,
        currencyId: seed.mruId,
        amount: '500',
        paymentMethodId: seed.cashMethodId,
        description: 'Utilities',
      })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/api/v1/expenses')
      .set('Cookie', seed.ownerCookie)
      .expect(200);

    expect(res.body.total).toBe(1);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].description).toBe('Utilities');
  });
});

// ---------------------------------------------------------------------------
// §6.7 — Balance exceeded
// ---------------------------------------------------------------------------

describe('POST /expenses — balance exceeded (§6.7)', () => {
  it('returns 422 insufficient_balance when expense exceeds available balance', async () => {
    const phones = nextPhone();
    const seed = await fullSeed(phones);
    await openMru(seed, '100');

    const res = await request(app.getHttpServer())
      .post('/api/v1/expenses')
      .set('Cookie', seed.ownerCookie)
      .send({
        expenseCategoryId: seed.categoryId,
        currencyId: seed.mruId,
        amount: '500',
        paymentMethodId: seed.cashMethodId,
        description: 'Too expensive',
      })
      .expect(422);

    expect(res.body.code).toBe('insufficient_balance');
  });
});

// ---------------------------------------------------------------------------
// §6.8 — requires_note enforcement
// ---------------------------------------------------------------------------

describe('POST /expenses — requires_note empty (§6.8)', () => {
  it('returns 422 method_note_required when requires_note method has no note', async () => {
    const phones = nextPhone();
    const seed = await fullSeed(phones);
    await openMru(seed, '5000');

    const res = await request(app.getHttpServer())
      .post('/api/v1/expenses')
      .set('Cookie', seed.ownerCookie)
      .send({
        expenseCategoryId: seed.categoryId,
        currencyId: seed.mruId,
        amount: '200',
        paymentMethodId: seed.noteMethodId,
        description: 'Wire expense without note',
      })
      .expect(422);

    expect(res.body.code).toBe('method_note_required');
  });

  it('succeeds when requires_note method has a note', async () => {
    const phones = nextPhone();
    const seed = await fullSeed(phones);
    await openMru(seed, '5000');

    await request(app.getHttpServer())
      .post('/api/v1/expenses')
      .set('Cookie', seed.ownerCookie)
      .send({
        expenseCategoryId: seed.categoryId,
        currencyId: seed.mruId,
        amount: '200',
        paymentMethodId: seed.noteMethodId,
        paymentMethodNote: 'Bank transfer ref #123',
        description: 'Wire expense with note',
      })
      .expect(201);
  });
});

// ---------------------------------------------------------------------------
// Inactive category
// ---------------------------------------------------------------------------

describe('POST /expenses — inactive category', () => {
  it('returns 422 inactive_expense_category for a deactivated category', async () => {
    const phones = nextPhone();
    const seed = await fullSeed(phones);
    await openMru(seed, '5000');

    await prisma.expenseCategory.update({
      where: { id: seed.categoryId },
      data: { isActive: false },
    });

    const res = await request(app.getHttpServer())
      .post('/api/v1/expenses')
      .set('Cookie', seed.ownerCookie)
      .send({
        expenseCategoryId: seed.categoryId,
        currencyId: seed.mruId,
        amount: '100',
        paymentMethodId: seed.cashMethodId,
        description: 'Should fail',
      })
      .expect(422);

    expect(res.body.code).toBe('inactive_expense_category');
  });
});

// ---------------------------------------------------------------------------
// DELETE is absent
// ---------------------------------------------------------------------------

describe('DELETE /expenses/:id', () => {
  it('returns 404 — delete is not exposed', async () => {
    const phones = nextPhone();
    const seed = await fullSeed(phones);

    await request(app.getHttpServer())
      .delete('/api/v1/expenses/00000000-0000-0000-0000-000000000001')
      .set('Cookie', seed.ownerCookie)
      .expect(404);
  });
});
