// P5-02/P5-04/P5-05/P5-07 · Customer payment integration tests.
//
// Priority order per docs/phases/phase-5.md §6:
//   1. Partial then final settlement — closes at zero with no residue.
//   2. Overpayment → PaymentExceedsOutstandingError (422).
//   3. Cross-currency payment → 422.
//   5. Recompute is called, not delta-patch (INV-2 catches a tampered outstanding).
//  11. DELETE /customer-payments/:id is absent (405/404).
//  12. Payment status transitions: UNPAID → PARTIALLY_PAID → PAID.
//
// Standing invariants INV-1/2/3/4/5/6/7/8/9 verified after each test by
// the global afterEach in test/setup-invariants.ts.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import argon2 from 'argon2';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/bootstrap.js';
import { PrismaService } from '../../src/common/prisma.service.js';
import { ALL_PERMISSIONS, OWNER_PERMISSIONS, ROLE_CODES } from '../../src/common/permissions.js';
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
function nextPhone() {
  seq += 1;
  return {
    owner: `+2229${String(seq).padStart(5, '0')}`,
    ip: `10.55.${(seq >> 8) & 255}.${seq & 255}`,
  };
}

interface Seed {
  ownerId: string;
  mruId: string;
  usdId: string;
  contactId: string;
  cashMethodId: string;
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
    const usd = await tx.currency.create({
      data: { code: 'USD', name: 'Dollar', decimalPlaces: 2 },
    });
    await tx.settings.create({
      data: { id: 1, baseCurrencyId: mru.id, businessTimezone: 'Africa/Nouakchott' },
    });

    const contact = await tx.contact.create({
      data: { name: 'Test Customer', isCustomer: true, isSupplier: false },
    });
    const cash = await tx.paymentMethod.create({
      data: { code: 'CASH', labelFr: 'Espèces', labelAr: 'نقداً', requiresNote: false },
    });
    return {
      ownerId: owner.id,
      mruId: mru.id,
      usdId: usd.id,
      contactId: contact.id,
      cashMethodId: cash.id,
    };
  });

  // Login
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .set('X-Forwarded-For', phones.ip)
    .send({ phone: phones.owner, pin: '1234' })
    .expect(204);
  const raw = Array.isArray(res.headers['set-cookie'])
    ? res.headers['set-cookie'][0]
    : res.headers['set-cookie'];
  const ownerCookie = (raw as string).split(';')[0] ?? '';

  return { ...ids, ownerCookie };
}

/** Open an MRU balance so the ledger can debit it during sales. */
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

/**
 * Create a sale (bureau delivers USD, customer pays MRU) with a
 * partial immediate payment, leaving a receivable for `outstanding` MRU.
 */
async function createSaleWithReceivable(
  seed: Seed,
  delivered: string,
  rate: string,
  immediate: string,
): Promise<{ saleId: string; receivableId: string }> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/sales')
    .set('Cookie', seed.ownerCookie)
    .send({
      contactId: seed.contactId,
      deliveredCurrencyId: seed.usdId,
      deliveredAmount: delivered,
      paymentCurrencyId: seed.mruId,
      rate,
      immediatePayment: immediate,
      paymentMethodId: seed.cashMethodId,
    })
    .expect(201);

  const saleId = res.body.id as string;
  const receivable = await prisma.receivable.findFirst({ where: { sourceId: saleId } });
  if (!receivable) throw new Error(`No receivable for sale ${saleId}`);
  return { saleId, receivableId: receivable.id };
}

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "audit_log",
      "payment",
      "allocation",
      "sale",
      "purchase",
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
// 1. Partial then final settlement — closes at zero with no rounding residue
// ---------------------------------------------------------------------------

// §6.1 — spec scenario verbatim: receivable of 100 000 MRU paid 30 000
// then 70 000, closes at exactly zero with no rounding residue.
describe('POST /customer-payments — partial then final settlement', () => {
  it('pays 30 000 then 70 000 MRU on a 100 000 receivable, closes at exactly zero', async () => {
    const phones = nextPhone();
    const seed = await fullSeed(phones);

    // Open 200 000 MRU to fund the purchase.
    await openMru(seed, '200000');

    // Buy 2 500 USD at 40 MRU each (fully paid) → +2 500 USD in inventory.
    await request(app.getHttpServer())
      .post('/api/v1/purchases')
      .set('Cookie', seed.ownerCookie)
      .send({
        contactId: seed.contactId,
        deliveredCurrencyId: seed.usdId,
        deliveredAmount: '2500',
        paymentCurrencyId: seed.mruId,
        rate: '40',
        immediatePayment: '100000',
        paymentMethodId: seed.cashMethodId,
      })
      .expect(201);

    // Sale: 2 500 USD @ 40 MRU, 0 immediate → 100 000 outstanding.
    const { receivableId } = await createSaleWithReceivable(seed, '2500', '40', '0');

    const receivableBefore = await prisma.receivable.findUniqueOrThrow({
      where: { id: receivableId },
    });
    expect(new Decimal(receivableBefore.outstandingAmount.toString()).toFixed(2)).toBe('100000.00');
    expect(receivableBefore.paymentStatus).toBe('UNPAID');

    // First payment: 30 000 MRU (partial).
    const pay1 = await request(app.getHttpServer())
      .post('/api/v1/customer-payments')
      .set('Cookie', seed.ownerCookie)
      .send({
        contactId: seed.contactId,
        currencyId: seed.mruId,
        amount: '30000',
        paymentMethodId: seed.cashMethodId,
      })
      .expect(201);

    expect(pay1.body.direction).toBe('RECEIVED_FROM_CUSTOMER');
    expect(pay1.body.status).toBe('CONFIRMED');

    const r1 = await prisma.receivable.findUniqueOrThrow({ where: { id: receivableId } });
    expect(new Decimal(r1.outstandingAmount.toString()).toFixed(2)).toBe('70000.00');
    expect(r1.paymentStatus).toBe('PARTIALLY_PAID');
    expect(r1.status).toBe('OPEN');

    // Second payment: 70 000 MRU (final).
    await request(app.getHttpServer())
      .post('/api/v1/customer-payments')
      .set('Cookie', seed.ownerCookie)
      .send({
        contactId: seed.contactId,
        currencyId: seed.mruId,
        amount: '70000',
        paymentMethodId: seed.cashMethodId,
      })
      .expect(201);

    const r2 = await prisma.receivable.findUniqueOrThrow({ where: { id: receivableId } });
    expect(new Decimal(r2.outstandingAmount.toString()).toFixed(2)).toBe('0.00');
    expect(r2.paymentStatus).toBe('PAID');
    expect(r2.status).toBe('CLOSED');

    // Verify by direct allocation query — matches the recompute formula.
    const allocs = await prisma.$queryRaw<{ total: string }[]>`
      SELECT SUM(a."amount")::text AS total
      FROM "allocation" a
      JOIN "payment" p ON p."id" = a."payment_id"
      WHERE a."target_type" = 'receivable'
        AND a."target_id" = ${receivableId}::uuid
        AND p."status" = 'CONFIRMED'
    `;
    expect(new Decimal(allocs[0]?.total ?? '0').toFixed(2)).toBe('100000.00');
  });
});

// ---------------------------------------------------------------------------
// 2. Overpayment → PaymentExceedsOutstandingError (422)
// ---------------------------------------------------------------------------

describe('POST /customer-payments — overpayment rejection', () => {
  it('returns 422 payment_exceeds_outstanding when amount > total outstanding', async () => {
    const phones = nextPhone();
    const seed = await fullSeed(phones);
    await openMru(seed, '500000');

    await request(app.getHttpServer())
      .post('/api/v1/purchases')
      .set('Cookie', seed.ownerCookie)
      .send({
        contactId: seed.contactId,
        deliveredCurrencyId: seed.usdId,
        deliveredAmount: '1000',
        paymentCurrencyId: seed.mruId,
        rate: '40',
        immediatePayment: '40000',
        paymentMethodId: seed.cashMethodId,
      })
      .expect(201);

    await createSaleWithReceivable(seed, '1000', '41', '0');
    // outstanding = 41 000 MRU

    const res = await request(app.getHttpServer())
      .post('/api/v1/customer-payments')
      .set('Cookie', seed.ownerCookie)
      .send({
        contactId: seed.contactId,
        currencyId: seed.mruId,
        amount: '41000.0001', // one minor unit over
        paymentMethodId: seed.cashMethodId,
      })
      .expect(422);

    expect(res.body.code).toBe('payment_exceeds_outstanding');
    expect(await prisma.payment.count()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Cross-currency payment → 422 (no_active_receivables in that currency)
// ---------------------------------------------------------------------------

describe('POST /customer-payments — cross-currency rejection', () => {
  it('refuses payment in USD when receivables are in MRU → 422', async () => {
    const phones = nextPhone();
    const seed = await fullSeed(phones);
    await openMru(seed, '500000');

    await request(app.getHttpServer())
      .post('/api/v1/purchases')
      .set('Cookie', seed.ownerCookie)
      .send({
        contactId: seed.contactId,
        deliveredCurrencyId: seed.usdId,
        deliveredAmount: '1000',
        paymentCurrencyId: seed.mruId,
        rate: '40',
        immediatePayment: '40000',
        paymentMethodId: seed.cashMethodId,
      })
      .expect(201);

    // Creates a receivable in MRU.
    await createSaleWithReceivable(seed, '1000', '41', '0');

    // Attempt payment in USD — no active receivables in USD for this contact.
    const res = await request(app.getHttpServer())
      .post('/api/v1/customer-payments')
      .set('Cookie', seed.ownerCookie)
      .send({
        contactId: seed.contactId,
        currencyId: seed.usdId,
        amount: '100',
        paymentMethodId: seed.cashMethodId,
        unitCostMru: '40',
      })
      .expect(422);

    expect(res.body.code).toBe('no_active_receivables');
    expect(await prisma.payment.count()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 5. Recompute is called, not delta-patch: INV-2 catches a manually
//    tampered outstanding_amount
// ---------------------------------------------------------------------------

describe('INV-2 — recompute not delta-patch', () => {
  it('outstanding_amount after payment equals original − Σ live allocations by direct query', async () => {
    const phones = nextPhone();
    const seed = await fullSeed(phones);
    await openMru(seed, '500000');

    await request(app.getHttpServer())
      .post('/api/v1/purchases')
      .set('Cookie', seed.ownerCookie)
      .send({
        contactId: seed.contactId,
        deliveredCurrencyId: seed.usdId,
        deliveredAmount: '1000',
        paymentCurrencyId: seed.mruId,
        rate: '40',
        immediatePayment: '40000',
        paymentMethodId: seed.cashMethodId,
      })
      .expect(201);

    const { receivableId } = await createSaleWithReceivable(seed, '1000', '41', '0');
    // outstanding = 41 000

    await request(app.getHttpServer())
      .post('/api/v1/customer-payments')
      .set('Cookie', seed.ownerCookie)
      .send({
        contactId: seed.contactId,
        currencyId: seed.mruId,
        amount: '15000',
        paymentMethodId: seed.cashMethodId,
      })
      .expect(201);

    const r = await prisma.receivable.findUniqueOrThrow({ where: { id: receivableId } });
    const allocs = await prisma.$queryRaw<{ total: string }[]>`
      SELECT COALESCE(SUM(a."amount"), 0)::text AS total
      FROM "allocation" a
      JOIN "payment" p ON p."id" = a."payment_id"
      WHERE a."target_type" = 'receivable'
        AND a."target_id" = ${receivableId}::uuid
        AND p."status" = 'CONFIRMED'
    `;
    const paidSum = new Decimal(allocs[0]?.total ?? '0');
    const originalAmount = new Decimal(r.originalAmount.toString());
    const computedOutstanding = originalAmount.minus(paidSum);
    const storedOutstanding = new Decimal(r.outstandingAmount.toString());

    // The stored value must equal the formula result (recompute was called).
    expect(computedOutstanding.toFixed(4)).toBe(storedOutstanding.toFixed(4));
    expect(computedOutstanding.toFixed(2)).toBe('26000.00');

    // Tamper the stored outstanding to a valid but wrong value and confirm INV-2 goes red.
    // Must be ≤ original_amount (DB CHECK), but wrong relative to live allocations.
    await prisma.$executeRaw`
      UPDATE "receivable"
      SET "outstanding_amount" = 30000
      WHERE "id" = ${receivableId}::uuid
    `;
    const { checkInv2 } = await import('../../src/common/invariants.js');
    const inv2 = await checkInv2(prisma);
    expect(inv2.failures.length).toBeGreaterThan(0);

    // Restore the correct value so the global afterEach invariant check passes.
    await prisma.$executeRaw`
      UPDATE "receivable"
      SET "outstanding_amount" = 26000
      WHERE "id" = ${receivableId}::uuid
    `;
  });
});

// ---------------------------------------------------------------------------
// 11. DELETE endpoint absent
// ---------------------------------------------------------------------------

describe('DELETE /customer-payments/:id — endpoint absent', () => {
  it('returns 404 (no route)', async () => {
    const phones = nextPhone();
    const seed = await fullSeed(phones);

    await request(app.getHttpServer())
      .delete('/api/v1/customer-payments/00000000-0000-0000-0000-000000000001')
      .set('Cookie', seed.ownerCookie)
      .expect(404);
  });
});

// ---------------------------------------------------------------------------
// 12. Payment status transitions
// ---------------------------------------------------------------------------

describe('POST /customer-payments — payment status transitions', () => {
  it('transitions UNPAID → PARTIALLY_PAID → PAID across two payments', async () => {
    const phones = nextPhone();
    const seed = await fullSeed(phones);
    await openMru(seed, '500000');

    await request(app.getHttpServer())
      .post('/api/v1/purchases')
      .set('Cookie', seed.ownerCookie)
      .send({
        contactId: seed.contactId,
        deliveredCurrencyId: seed.usdId,
        deliveredAmount: '1000',
        paymentCurrencyId: seed.mruId,
        rate: '40',
        immediatePayment: '40000',
        paymentMethodId: seed.cashMethodId,
      })
      .expect(201);

    const { receivableId } = await createSaleWithReceivable(seed, '1000', '41', '0');

    const initial = await prisma.receivable.findUniqueOrThrow({ where: { id: receivableId } });
    expect(initial.paymentStatus).toBe('UNPAID');

    // First partial payment.
    await request(app.getHttpServer())
      .post('/api/v1/customer-payments')
      .set('Cookie', seed.ownerCookie)
      .send({
        contactId: seed.contactId,
        currencyId: seed.mruId,
        amount: '20000',
        paymentMethodId: seed.cashMethodId,
      })
      .expect(201);

    const afterFirst = await prisma.receivable.findUniqueOrThrow({ where: { id: receivableId } });
    expect(afterFirst.paymentStatus).toBe('PARTIALLY_PAID');
    expect(afterFirst.status).toBe('OPEN');

    // Final payment.
    await request(app.getHttpServer())
      .post('/api/v1/customer-payments')
      .set('Cookie', seed.ownerCookie)
      .send({
        contactId: seed.contactId,
        currencyId: seed.mruId,
        amount: '21000',
        paymentMethodId: seed.cashMethodId,
      })
      .expect(201);

    const afterFinal = await prisma.receivable.findUniqueOrThrow({ where: { id: receivableId } });
    expect(afterFinal.paymentStatus).toBe('PAID');
    expect(afterFinal.status).toBe('CLOSED');
  });

  it('auto-allocates across two receivables oldest-first', async () => {
    const phones = nextPhone();
    const seed = await fullSeed(phones);
    await openMru(seed, '500000');

    // Two purchases to fund inventory.
    await request(app.getHttpServer())
      .post('/api/v1/purchases')
      .set('Cookie', seed.ownerCookie)
      .send({
        contactId: seed.contactId,
        deliveredCurrencyId: seed.usdId,
        deliveredAmount: '2000',
        paymentCurrencyId: seed.mruId,
        rate: '40',
        immediatePayment: '80000',
        paymentMethodId: seed.cashMethodId,
      })
      .expect(201);

    // Older receivable: 10 000 MRU outstanding.
    const { receivableId: r1Id } = await createSaleWithReceivable(seed, '500', '41', '10500');

    // Newer receivable: 20 000 MRU outstanding (no immediate payment).
    const { receivableId: r2Id } = await createSaleWithReceivable(seed, '1000', '41', '21000');

    // Pay 25 000 — should fill r1 (10 000) then 15 000 on r2.
    await request(app.getHttpServer())
      .post('/api/v1/customer-payments')
      .set('Cookie', seed.ownerCookie)
      .send({
        contactId: seed.contactId,
        currencyId: seed.mruId,
        amount: '25000',
        paymentMethodId: seed.cashMethodId,
      })
      .expect(201);

    const r1 = await prisma.receivable.findUniqueOrThrow({ where: { id: r1Id } });
    const r2 = await prisma.receivable.findUniqueOrThrow({ where: { id: r2Id } });

    expect(new Decimal(r1.outstandingAmount.toString()).toFixed(2)).toBe('0.00');
    expect(r1.paymentStatus).toBe('PAID');
    expect(new Decimal(r2.outstandingAmount.toString()).toFixed(2)).toBe('5000.00');
    expect(r2.paymentStatus).toBe('PARTIALLY_PAID');
  });
});

// ---------------------------------------------------------------------------
// Read endpoints — smoke tests
// ---------------------------------------------------------------------------

describe('GET /payments, /receivables, /payables', () => {
  it('lists payments with pagination', async () => {
    const phones = nextPhone();
    const seed = await fullSeed(phones);
    await openMru(seed, '500000');

    await request(app.getHttpServer())
      .post('/api/v1/purchases')
      .set('Cookie', seed.ownerCookie)
      .send({
        contactId: seed.contactId,
        deliveredCurrencyId: seed.usdId,
        deliveredAmount: '1000',
        paymentCurrencyId: seed.mruId,
        rate: '40',
        immediatePayment: '40000',
        paymentMethodId: seed.cashMethodId,
      })
      .expect(201);

    await createSaleWithReceivable(seed, '1000', '41', '0');

    await request(app.getHttpServer())
      .post('/api/v1/customer-payments')
      .set('Cookie', seed.ownerCookie)
      .send({
        contactId: seed.contactId,
        currencyId: seed.mruId,
        amount: '10000',
        paymentMethodId: seed.cashMethodId,
      })
      .expect(201);

    const paymentsRes = await request(app.getHttpServer())
      .get('/api/v1/payments')
      .set('Cookie', seed.ownerCookie)
      .expect(200);
    expect(paymentsRes.body.total).toBe(1);
    expect(paymentsRes.body.data[0].direction).toBe('RECEIVED_FROM_CUSTOMER');

    const recRes = await request(app.getHttpServer())
      .get('/api/v1/receivables')
      .set('Cookie', seed.ownerCookie)
      .expect(200);
    expect(recRes.body.total).toBe(1);

    const payRes = await request(app.getHttpServer())
      .get('/api/v1/payables')
      .set('Cookie', seed.ownerCookie)
      .expect(200);
    expect(payRes.body.total).toBe(0);
  });
});
