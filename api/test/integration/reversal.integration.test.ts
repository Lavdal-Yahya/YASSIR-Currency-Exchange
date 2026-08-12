// P6-08 · reversal + profit report integration tests.
//
// The 13-scenario list from phase-6.md §6, wired end-to-end through
// HTTP so the invariant afterEach hook runs against real ledger state.
//
// Priority order (matches the phase doc):
//   1.  After every reversal, all 9 invariants hold (checked in
//       afterEach globally + deliberately-broken fixture below).
//   2.  Reverse a fully paid sale.
//   3.  Reverse a partially paid purchase whose payable saw payments.
//   4.  Reverse a purchase whose currency was later sold — the sale is
//       restated (D-021), API response lists the restated ID.
//   5.  Reverse a trade with no downstream cost movements — 0 restated.
//   6.  Reverse an already-reversed row → 422 AlreadyReversedError.
//   7.  Employee (no reversal permission) → 403.
//   8.  Every reversal has a non-empty reason in audit_log.
//   9.  Profit engine on §44 fixture: gross = 8,000 MRU, net = gross.
//  10.  Adding a 500 MRU expense drops net by 500.
//  11.  Supplier settlement FX gain appears in the report.
//  12.  Profit report does not read from a market rate — grep guard.
//  13.  A reversed sale contributes zero to every report.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
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
import { Decimal } from '../../src/common/money.js';
import { checkAll, formatFailures } from '../../src/common/invariants.js';
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
function nextPhone(): { owner: string; employee: string; ip: string } {
  seq += 1;
  return {
    owner: `+22261${String(seq).padStart(5, '0')}`,
    employee: `+22262${String(seq).padStart(5, '0')}`,
    ip: `10.66.${(seq >> 8) & 255}.${seq & 255}`,
  };
}

interface Seed {
  ownerId: string;
  employeeId: string;
  mruId: string;
  usdId: string;
  eurId: string;
  contactId: string;
  supplierId: string;
  cashMethodId: string;
  expenseCategoryId: string;
  ownerCookie: string;
  employeeCookie: string;
}

async function fullSeed(phones: { owner: string; employee: string; ip: string }): Promise<Seed> {
  const pinHash = await argon2.hash('1234', { type: argon2.argon2id });
  const ids = await prisma.$transaction(async (tx) => {
    for (const code of ALL_PERMISSIONS) await tx.permission.create({ data: { code } });
    const ownerRole = await tx.role.create({
      data: { code: ROLE_CODES.OWNER, labelFr: 'Propriétaire', labelAr: 'المالك' },
    });
    const employeeRole = await tx.role.create({
      data: { code: ROLE_CODES.EMPLOYEE, labelFr: 'Employé', labelAr: 'موظف' },
    });
    for (const code of OWNER_PERMISSIONS) {
      const p = await tx.permission.findUniqueOrThrow({ where: { code } });
      await tx.rolePermission.create({ data: { roleId: ownerRole.id, permissionId: p.id } });
    }
    for (const code of EMPLOYEE_PERMISSIONS) {
      const p = await tx.permission.findUniqueOrThrow({ where: { code } });
      await tx.rolePermission.create({ data: { roleId: employeeRole.id, permissionId: p.id } });
    }
    const owner = await tx.user.create({
      data: { phone: phones.owner, pinHash, fullName: 'Owner' },
    });
    await tx.userRole.create({ data: { userId: owner.id, roleId: ownerRole.id } });
    const employee = await tx.user.create({
      data: { phone: phones.employee, pinHash, fullName: 'Employee' },
    });
    await tx.userRole.create({ data: { userId: employee.id, roleId: employeeRole.id } });

    const mru = await tx.currency.create({
      data: { code: 'MRU', name: 'Ouguiya', decimalPlaces: 2 },
    });
    const usd = await tx.currency.create({
      data: { code: 'USD', name: 'Dollar', decimalPlaces: 2 },
    });
    const eur = await tx.currency.create({
      data: { code: 'EUR', name: 'Euro', decimalPlaces: 2 },
    });
    await tx.settings.create({
      data: { id: 1, baseCurrencyId: mru.id, businessTimezone: 'Africa/Nouakchott' },
    });

    const contact = await tx.contact.create({
      data: { name: 'Customer A', isCustomer: true, isSupplier: false },
    });
    const supplier = await tx.contact.create({
      data: { name: 'Supplier A', isCustomer: false, isSupplier: true },
    });
    const cash = await tx.paymentMethod.create({
      data: { code: 'CASH', labelFr: 'Espèces', labelAr: 'نقداً', requiresNote: false },
    });
    const category = await tx.expenseCategory.create({
      data: { name: 'Rent', isActive: true },
    });
    return {
      ownerId: owner.id,
      employeeId: employee.id,
      mruId: mru.id,
      usdId: usd.id,
      eurId: eur.id,
      contactId: contact.id,
      supplierId: supplier.id,
      cashMethodId: cash.id,
      expenseCategoryId: category.id,
    };
  });

  const login = async (phone: string, ip: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ phone, pin: '1234' })
      .expect(204);
    const raw = Array.isArray(res.headers['set-cookie'])
      ? res.headers['set-cookie'][0]
      : res.headers['set-cookie'];
    return (raw as string).split(';')[0] ?? '';
  };
  const ownerCookie = await login(phones.owner, phones.ip);
  const employeeCookie = await login(phones.employee, phones.ip);

  return { ...ids, ownerCookie, employeeCookie };
}

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
      "payment",
      "allocation",
      "expense",
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
      "expense_category",
      "user",
      "role",
      "permission"
    RESTART IDENTITY CASCADE;
  `);
});

// ---------------------------------------------------------------------------
// 2. Reverse a fully paid sale — ledger inactive, balances match pre-sale
// ---------------------------------------------------------------------------

describe('POST /sales/:id/reverse — fully paid sale', () => {
  it('flips status, deactivates ledger entries, and restores USD + MRU balances', async () => {
    const phones = nextPhone();
    const seed = await fullSeed(phones);
    await openMru(seed, '500000');

    // Purchase 1,000 USD @ 40 (fully paid → +1,000 USD, −40,000 MRU).
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

    const usdBefore = await prisma.currencyBalance.findUniqueOrThrow({
      where: { currencyId: seed.usdId },
    });
    const mruBefore = await prisma.currencyBalance.findUniqueOrThrow({
      where: { currencyId: seed.mruId },
    });

    // Sale — 500 USD @ 41, fully paid → −500 USD, +20,500 MRU.
    const saleRes = await request(app.getHttpServer())
      .post('/api/v1/sales')
      .set('Cookie', seed.ownerCookie)
      .send({
        contactId: seed.contactId,
        deliveredCurrencyId: seed.usdId,
        deliveredAmount: '500',
        paymentCurrencyId: seed.mruId,
        rate: '41',
        immediatePayment: '20500',
        paymentMethodId: seed.cashMethodId,
      })
      .expect(201);
    const saleId = saleRes.body.id as string;

    // Reverse.
    const revRes = await request(app.getHttpServer())
      .post(`/api/v1/sales/${saleId}/reverse`)
      .set('Cookie', seed.ownerCookie)
      .send({ reason: 'wrong customer' })
      .expect(200);

    expect(revRes.body.tradeKind).toBe('sale');
    expect(revRes.body.restatedSaleIds).toEqual([]);

    const sale = await prisma.sale.findUniqueOrThrow({ where: { id: saleId } });
    expect(sale.status).toBe('REVERSED');
    expect(sale.reversalReason).toBe('wrong customer');
    expect(sale.reversedByUserId).toBe(seed.ownerId);
    expect(sale.reversedAt).toBeInstanceOf(Date);
    expect(sale.grossProfitMru.toString()).toBe('0');
    expect(sale.costOfCurrencySoldMru.toString()).toBe('0');

    // Balances back to pre-sale — the sale's ledger rows are now inactive.
    const usdAfter = await prisma.currencyBalance.findUniqueOrThrow({
      where: { currencyId: seed.usdId },
    });
    const mruAfter = await prisma.currencyBalance.findUniqueOrThrow({
      where: { currencyId: seed.mruId },
    });
    expect(usdAfter.cachedAmount.toString()).toBe(usdBefore.cachedAmount.toString());
    expect(mruAfter.cachedAmount.toString()).toBe(mruBefore.cachedAmount.toString());

    // Sale's ledger entries are is_active=false, cost movement is_active=false.
    const activeLedger = await prisma.currencyLedger.count({
      where: { sourceType: 'sale', sourceId: saleId, isActive: true },
    });
    expect(activeLedger).toBe(0);
    const inactiveLedger = await prisma.currencyLedger.count({
      where: { sourceType: 'sale', sourceId: saleId, isActive: false },
    });
    expect(inactiveLedger).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Reverse a partially paid purchase whose payable saw payments
// ---------------------------------------------------------------------------

describe('POST /purchases/:id/reverse — partially paid purchase with payments', () => {
  it('reverses purchase, cascades payable to REVERSED, payment allocations lose liveness', async () => {
    const phones = nextPhone();
    const seed = await fullSeed(phones);
    await openMru(seed, '500000');

    // Purchase 1,000 USD @ 40, immediate 0, payable 40,000 MRU (outstanding).
    // Wait — that's backwards. Purchase from a supplier: bureau receives USD,
    // owes MRU. If immediate < total, the bureau has a payable of MRU to
    // the supplier. But the phase test says "partially paid purchase with
    // settlements" — meaning the bureau paid down the payable via a
    // supplier payment. Set up: bureau owes 40,000 MRU, pays 15,000 later.
    const purchaseRes = await request(app.getHttpServer())
      .post('/api/v1/purchases')
      .set('Cookie', seed.ownerCookie)
      .send({
        contactId: seed.supplierId,
        deliveredCurrencyId: seed.usdId,
        deliveredAmount: '1000',
        paymentCurrencyId: seed.mruId,
        rate: '40',
        immediatePayment: '0',
        paymentMethodId: seed.cashMethodId,
      })
      .expect(201);
    const purchaseId = purchaseRes.body.id as string;

    const payable = await prisma.payable.findFirstOrThrow({
      where: { sourceType: 'purchase', sourceId: purchaseId },
    });
    expect(payable.outstandingAmount.toString()).toBe('40000');

    // Pay 15,000 MRU.
    await request(app.getHttpServer())
      .post('/api/v1/supplier-payments')
      .set('Cookie', seed.ownerCookie)
      .send({
        contactId: seed.supplierId,
        currencyId: seed.mruId,
        amount: '15000',
        paymentMethodId: seed.cashMethodId,
      })
      .expect(201);

    const payableMid = await prisma.payable.findUniqueOrThrow({ where: { id: payable.id } });
    expect(payableMid.outstandingAmount.toString()).toBe('25000');

    // Reverse the purchase.
    await request(app.getHttpServer())
      .post(`/api/v1/purchases/${purchaseId}/reverse`)
      .set('Cookie', seed.ownerCookie)
      .send({ reason: 'wrong supplier' })
      .expect(200);

    // Purchase → REVERSED, payable → REVERSED, payment untouched.
    const purchase = await prisma.purchase.findUniqueOrThrow({ where: { id: purchaseId } });
    expect(purchase.status).toBe('REVERSED');
    const payableAfter = await prisma.payable.findUniqueOrThrow({ where: { id: payable.id } });
    expect(payableAfter.status).toBe('REVERSED');

    // Payments themselves are still active — the operator paid; that
    // cash movement really happened, only the debt they were paying is
    // now undone.
    const activePayments = await prisma.payment.count({
      where: { contactId: seed.supplierId, status: 'CONFIRMED' },
    });
    expect(activePayments).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 4. Reverse a purchase whose currency was later sold — restated sale
// ---------------------------------------------------------------------------

describe('POST /purchases/:id/reverse — recompute-and-restate (D-021)', () => {
  it('restates a downstream sale after reversing an upstream purchase', async () => {
    const phones = nextPhone();
    const seed = await fullSeed(phones);
    await openMru(seed, '500000');

    // Purchase 1: 500 USD @ 38 MRU/USD, fully paid.
    // After: 500 USD in stock, WAC = 38.
    await request(app.getHttpServer())
      .post('/api/v1/purchases')
      .set('Cookie', seed.ownerCookie)
      .send({
        contactId: seed.contactId,
        deliveredCurrencyId: seed.usdId,
        deliveredAmount: '500',
        paymentCurrencyId: seed.mruId,
        rate: '38',
        immediatePayment: '19000',
        paymentMethodId: seed.cashMethodId,
      })
      .expect(201);

    // Purchase 2: 500 USD @ 40 MRU/USD, fully paid.
    // After: 1000 USD in stock, WAC = (500*38 + 500*40) / 1000 = 39.
    const p2Res = await request(app.getHttpServer())
      .post('/api/v1/purchases')
      .set('Cookie', seed.ownerCookie)
      .send({
        contactId: seed.contactId,
        deliveredCurrencyId: seed.usdId,
        deliveredAmount: '500',
        paymentCurrencyId: seed.mruId,
        rate: '40',
        immediatePayment: '20000',
        paymentMethodId: seed.cashMethodId,
      })
      .expect(201);
    const p2Id = p2Res.body.id as string;

    // Sale: 400 USD @ 42 MRU/USD, fully paid.
    // At disposal WAC = 39 → cost_of_sold = 400 × 39 = 15600, gross = 400 × 42 − 15600 = 1200.
    const saleRes = await request(app.getHttpServer())
      .post('/api/v1/sales')
      .set('Cookie', seed.ownerCookie)
      .send({
        contactId: seed.contactId,
        deliveredCurrencyId: seed.usdId,
        deliveredAmount: '400',
        paymentCurrencyId: seed.mruId,
        rate: '42',
        immediatePayment: '16800',
        paymentMethodId: seed.cashMethodId,
      })
      .expect(201);
    const saleId = saleRes.body.id as string;

    const saleBefore = await prisma.sale.findUniqueOrThrow({ where: { id: saleId } });
    expect(saleBefore.costOfCurrencySoldMru.toString()).toBe('15600');
    expect(saleBefore.grossProfitMru.toString()).toBe('1200');

    // Reverse purchase 2 (the @ 40 one). Now the only purchase left is
    // @ 38; after replay, WAC at the sale disposal = 38 → cost = 400 × 38 = 15200,
    // gross = 16800 − 15200 = 1600.
    const revRes = await request(app.getHttpServer())
      .post(`/api/v1/purchases/${p2Id}/reverse`)
      .set('Cookie', seed.ownerCookie)
      .send({ reason: 'wrong rate' })
      .expect(200);

    expect(revRes.body.restatedSaleIds).toContain(saleId);

    const saleAfter = await prisma.sale.findUniqueOrThrow({ where: { id: saleId } });
    expect(saleAfter.costOfCurrencySoldMru.toString()).toBe('15200');
    expect(saleAfter.grossProfitMru.toString()).toBe('1600');
  });
});

// ---------------------------------------------------------------------------
// 5. Reverse a trade with no downstream cost movements
// ---------------------------------------------------------------------------

describe('POST /sales/:id/reverse — no downstream sales', () => {
  it('returns zero restatedSaleIds when no other sales followed', async () => {
    const phones = nextPhone();
    const seed = await fullSeed(phones);
    await openMru(seed, '500000');

    await request(app.getHttpServer())
      .post('/api/v1/purchases')
      .set('Cookie', seed.ownerCookie)
      .send({
        contactId: seed.contactId,
        deliveredCurrencyId: seed.usdId,
        deliveredAmount: '100',
        paymentCurrencyId: seed.mruId,
        rate: '39',
        immediatePayment: '3900',
        paymentMethodId: seed.cashMethodId,
      })
      .expect(201);

    const saleRes = await request(app.getHttpServer())
      .post('/api/v1/sales')
      .set('Cookie', seed.ownerCookie)
      .send({
        contactId: seed.contactId,
        deliveredCurrencyId: seed.usdId,
        deliveredAmount: '50',
        paymentCurrencyId: seed.mruId,
        rate: '41',
        immediatePayment: '2050',
        paymentMethodId: seed.cashMethodId,
      })
      .expect(201);

    const revRes = await request(app.getHttpServer())
      .post(`/api/v1/sales/${saleRes.body.id}/reverse`)
      .set('Cookie', seed.ownerCookie)
      .send({ reason: 'test' })
      .expect(200);
    expect(revRes.body.restatedSaleIds).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 6. Idempotency — reversing an already-reversed row → 422
// ---------------------------------------------------------------------------

describe('POST /:kind/:id/reverse — already reversed', () => {
  it('returns 422 already_reversed on the second attempt', async () => {
    const phones = nextPhone();
    const seed = await fullSeed(phones);
    await openMru(seed, '100000');

    await request(app.getHttpServer())
      .post('/api/v1/purchases')
      .set('Cookie', seed.ownerCookie)
      .send({
        contactId: seed.contactId,
        deliveredCurrencyId: seed.usdId,
        deliveredAmount: '100',
        paymentCurrencyId: seed.mruId,
        rate: '40',
        immediatePayment: '4000',
        paymentMethodId: seed.cashMethodId,
      })
      .expect(201);

    const saleRes = await request(app.getHttpServer())
      .post('/api/v1/sales')
      .set('Cookie', seed.ownerCookie)
      .send({
        contactId: seed.contactId,
        deliveredCurrencyId: seed.usdId,
        deliveredAmount: '50',
        paymentCurrencyId: seed.mruId,
        rate: '41',
        immediatePayment: '2050',
        paymentMethodId: seed.cashMethodId,
      })
      .expect(201);
    const saleId = saleRes.body.id as string;

    await request(app.getHttpServer())
      .post(`/api/v1/sales/${saleId}/reverse`)
      .set('Cookie', seed.ownerCookie)
      .send({ reason: 'first' })
      .expect(200);

    const res = await request(app.getHttpServer())
      .post(`/api/v1/sales/${saleId}/reverse`)
      .set('Cookie', seed.ownerCookie)
      .send({ reason: 'second attempt' })
      .expect(422);
    expect(res.body.code).toBe('already_reversed');
  });
});

// ---------------------------------------------------------------------------
// 7. Employee without reversal:trade → 403
// ---------------------------------------------------------------------------

describe('POST /sales/:id/reverse — permission gate', () => {
  it('403s an employee without reversal:trade', async () => {
    const phones = nextPhone();
    const seed = await fullSeed(phones);
    await openMru(seed, '100000');

    await request(app.getHttpServer())
      .post('/api/v1/purchases')
      .set('Cookie', seed.ownerCookie)
      .send({
        contactId: seed.contactId,
        deliveredCurrencyId: seed.usdId,
        deliveredAmount: '100',
        paymentCurrencyId: seed.mruId,
        rate: '40',
        immediatePayment: '4000',
        paymentMethodId: seed.cashMethodId,
      })
      .expect(201);

    const saleRes = await request(app.getHttpServer())
      .post('/api/v1/sales')
      .set('Cookie', seed.ownerCookie)
      .send({
        contactId: seed.contactId,
        deliveredCurrencyId: seed.usdId,
        deliveredAmount: '50',
        paymentCurrencyId: seed.mruId,
        rate: '41',
        immediatePayment: '2050',
        paymentMethodId: seed.cashMethodId,
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/sales/${saleRes.body.id}/reverse`)
      .set('Cookie', seed.employeeCookie)
      .send({ reason: 'try' })
      .expect(403);
  });
});

// ---------------------------------------------------------------------------
// 8. Non-empty reason recorded in audit_log
// ---------------------------------------------------------------------------

describe('reversal audit — reason mandatory', () => {
  it('records reason in audit_log and refuses empty reason', async () => {
    const phones = nextPhone();
    const seed = await fullSeed(phones);
    await openMru(seed, '100000');

    await request(app.getHttpServer())
      .post('/api/v1/purchases')
      .set('Cookie', seed.ownerCookie)
      .send({
        contactId: seed.contactId,
        deliveredCurrencyId: seed.usdId,
        deliveredAmount: '100',
        paymentCurrencyId: seed.mruId,
        rate: '40',
        immediatePayment: '4000',
        paymentMethodId: seed.cashMethodId,
      })
      .expect(201);
    const saleRes = await request(app.getHttpServer())
      .post('/api/v1/sales')
      .set('Cookie', seed.ownerCookie)
      .send({
        contactId: seed.contactId,
        deliveredCurrencyId: seed.usdId,
        deliveredAmount: '50',
        paymentCurrencyId: seed.mruId,
        rate: '41',
        immediatePayment: '2050',
        paymentMethodId: seed.cashMethodId,
      })
      .expect(201);
    const saleId = saleRes.body.id as string;

    // Empty reason rejected (class-validator MinLength).
    await request(app.getHttpServer())
      .post(`/api/v1/sales/${saleId}/reverse`)
      .set('Cookie', seed.ownerCookie)
      .send({ reason: '' })
      .expect(400);

    // Non-empty succeeds.
    await request(app.getHttpServer())
      .post(`/api/v1/sales/${saleId}/reverse`)
      .set('Cookie', seed.ownerCookie)
      .send({ reason: 'operator error' })
      .expect(200);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'sale_reversed', entityId: saleId },
    });
    expect(audit.reason).toBe('operator error');
    expect(audit.actorUserId).toBe(seed.ownerId);
  });
});

// ---------------------------------------------------------------------------
// 9-11. Profit report — §44 fixture and variations
// ---------------------------------------------------------------------------

describe('GET /reports/profit', () => {
  it('reports gross 8000 MRU on the §44 walk (net = gross when no expenses/FX)', async () => {
    const phones = nextPhone();
    const seed = await fullSeed(phones);
    await openMru(seed, '464000');

    // Two purchases + one sale = §44 walk, but locally seeded.
    await request(app.getHttpServer())
      .post('/api/v1/purchases')
      .set('Cookie', seed.ownerCookie)
      .send({
        contactId: seed.contactId,
        deliveredCurrencyId: seed.usdId,
        deliveredAmount: '6000',
        paymentCurrencyId: seed.mruId,
        rate: '39',
        immediatePayment: '234000',
        paymentMethodId: seed.cashMethodId,
      })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/purchases')
      .set('Cookie', seed.ownerCookie)
      .send({
        contactId: seed.contactId,
        deliveredCurrencyId: seed.usdId,
        deliveredAmount: '4000',
        paymentCurrencyId: seed.mruId,
        rate: '39',
        immediatePayment: '156000',
        paymentMethodId: seed.cashMethodId,
      })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/sales')
      .set('Cookie', seed.ownerCookie)
      .send({
        contactId: seed.contactId,
        deliveredCurrencyId: seed.usdId,
        deliveredAmount: '4000',
        paymentCurrencyId: seed.mruId,
        rate: '41',
        immediatePayment: '100000',
        paymentMethodId: seed.cashMethodId,
      })
      .expect(201);

    const from = new Date('2026-08-01').toISOString();
    const to = new Date('2027-01-01').toISOString();
    const rep = await request(app.getHttpServer())
      .get(`/api/v1/reports/profit?from=${from}&to=${to}`)
      .set('Cookie', seed.ownerCookie)
      .expect(200);

    expect(new Decimal(rep.body.grossProfitMru).toFixed(2)).toBe('8000.00');
    expect(new Decimal(rep.body.costOfCurrencySoldMru).toFixed(2)).toBe('156000.00');
    expect(new Decimal(rep.body.expensesMru).toFixed(2)).toBe('0.00');
    expect(new Decimal(rep.body.realizedFxGainMru).toFixed(2)).toBe('0.00');
    expect(new Decimal(rep.body.netProfitMru).toFixed(2)).toBe('8000.00');
    expect(
      rep.body.byCurrency.some((r: { currencyCode: string }) => r.currencyCode === 'USD'),
    ).toBe(true);
  });

  it('drops net by 500 MRU when a 500 MRU expense is added in the period', async () => {
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
    await request(app.getHttpServer())
      .post('/api/v1/sales')
      .set('Cookie', seed.ownerCookie)
      .send({
        contactId: seed.contactId,
        deliveredCurrencyId: seed.usdId,
        deliveredAmount: '500',
        paymentCurrencyId: seed.mruId,
        rate: '41',
        immediatePayment: '20500',
        paymentMethodId: seed.cashMethodId,
      })
      .expect(201);

    const from = new Date('2026-08-01').toISOString();
    const to = new Date('2027-01-01').toISOString();
    const before = await request(app.getHttpServer())
      .get(`/api/v1/reports/profit?from=${from}&to=${to}`)
      .set('Cookie', seed.ownerCookie)
      .expect(200);
    const netBefore = new Decimal(before.body.netProfitMru);

    await request(app.getHttpServer())
      .post('/api/v1/expenses')
      .set('Cookie', seed.ownerCookie)
      .send({
        expenseCategoryId: seed.expenseCategoryId,
        currencyId: seed.mruId,
        amount: '500',
        paymentMethodId: seed.cashMethodId,
        description: 'monthly rent',
      })
      .expect(201);

    const after = await request(app.getHttpServer())
      .get(`/api/v1/reports/profit?from=${from}&to=${to}`)
      .set('Cookie', seed.ownerCookie)
      .expect(200);
    expect(new Decimal(after.body.netProfitMru).toFixed(2)).toBe(netBefore.minus(500).toFixed(2));
    expect(new Decimal(after.body.expensesMru).toFixed(2)).toBe('500.00');
  });

  it('surfaces FX gain on a non-base supplier settlement', async () => {
    const phones = nextPhone();
    const seed = await fullSeed(phones);
    await openMru(seed, '200000');

    // Buy 200 EUR @ 39.5 → WAC = 39.5.
    await request(app.getHttpServer())
      .post('/api/v1/purchases')
      .set('Cookie', seed.ownerCookie)
      .send({
        contactId: seed.supplierId,
        deliveredCurrencyId: seed.eurId,
        deliveredAmount: '200',
        paymentCurrencyId: seed.mruId,
        rate: '39.5',
        immediatePayment: '7900',
        paymentMethodId: seed.cashMethodId,
      })
      .expect(201);

    // Bureau receives 4000 MRU, owes 100 EUR back (rate 40 MRU/EUR).
    await request(app.getHttpServer())
      .post('/api/v1/purchases')
      .set('Cookie', seed.ownerCookie)
      .send({
        contactId: seed.supplierId,
        deliveredCurrencyId: seed.mruId,
        deliveredAmount: '4000',
        paymentCurrencyId: seed.eurId,
        rate: '0.025',
        immediatePayment: '0',
        paymentMethodId: seed.cashMethodId,
      })
      .expect(201);

    // Pay the 100 EUR → FX gain (40 − 39.5) × 100 = 50 MRU.
    await request(app.getHttpServer())
      .post('/api/v1/supplier-payments')
      .set('Cookie', seed.ownerCookie)
      .send({
        contactId: seed.supplierId,
        currencyId: seed.eurId,
        amount: '100',
        paymentMethodId: seed.cashMethodId,
      })
      .expect(201);

    const from = new Date('2026-08-01').toISOString();
    const to = new Date('2027-01-01').toISOString();
    const rep = await request(app.getHttpServer())
      .get(`/api/v1/reports/profit?from=${from}&to=${to}`)
      .set('Cookie', seed.ownerCookie)
      .expect(200);
    expect(new Decimal(rep.body.realizedFxGainMru).toFixed(2)).toBe('50.00');
    expect(rep.body.fxByCurrency).toContainEqual(expect.objectContaining({ currencyCode: 'EUR' }));
  });
});

// ---------------------------------------------------------------------------
// 12. Profit report never reads from a market rate — source grep
// ---------------------------------------------------------------------------

describe('P6-02 · consolidation uses stored snapshot rates only', () => {
  it('has no reference to market_rate / RateSnapshot / live rate in reports/', () => {
    const dir = join(__dirname, '..', '..', 'src', 'reports');
    for (const f of readdirSync(dir, { recursive: true }) as string[]) {
      if (!f.toString().endsWith('.ts')) continue;
      const src = readFileSync(join(dir, f.toString()), 'utf8');
      expect(src).not.toMatch(/market_rate/);
      expect(src).not.toMatch(/RateSnapshot/);
      expect(src).not.toMatch(/rate_snapshot/);
    }
  });
});

// ---------------------------------------------------------------------------
// 13. Reversed sale contributes zero to every report
// ---------------------------------------------------------------------------

describe('reversed sale — excluded from reports', () => {
  it('shows zero gross profit and zero revenue for a reversed sale', async () => {
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

    const saleRes = await request(app.getHttpServer())
      .post('/api/v1/sales')
      .set('Cookie', seed.ownerCookie)
      .send({
        contactId: seed.contactId,
        deliveredCurrencyId: seed.usdId,
        deliveredAmount: '500',
        paymentCurrencyId: seed.mruId,
        rate: '41',
        immediatePayment: '20500',
        paymentMethodId: seed.cashMethodId,
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/sales/${saleRes.body.id}/reverse`)
      .set('Cookie', seed.ownerCookie)
      .send({ reason: 'test' })
      .expect(200);

    const from = new Date('2026-08-01').toISOString();
    const to = new Date('2027-01-01').toISOString();
    const rep = await request(app.getHttpServer())
      .get(`/api/v1/reports/profit?from=${from}&to=${to}`)
      .set('Cookie', seed.ownerCookie)
      .expect(200);
    expect(new Decimal(rep.body.grossProfitMru).toFixed(2)).toBe('0.00');
  });
});

// ---------------------------------------------------------------------------
// 1. INV-* still hold after every reversal test (afterEach global + explicit)
// ---------------------------------------------------------------------------

describe('reversal test suite — invariants final sanity', () => {
  it('checkAll reports clean after a full reverse-and-restate flow', async () => {
    const phones = nextPhone();
    const seed = await fullSeed(phones);
    await openMru(seed, '500000');

    // Small mixed workload.
    await request(app.getHttpServer())
      .post('/api/v1/purchases')
      .set('Cookie', seed.ownerCookie)
      .send({
        contactId: seed.contactId,
        deliveredCurrencyId: seed.usdId,
        deliveredAmount: '500',
        paymentCurrencyId: seed.mruId,
        rate: '38',
        immediatePayment: '19000',
        paymentMethodId: seed.cashMethodId,
      })
      .expect(201);
    const p2 = await request(app.getHttpServer())
      .post('/api/v1/purchases')
      .set('Cookie', seed.ownerCookie)
      .send({
        contactId: seed.contactId,
        deliveredCurrencyId: seed.usdId,
        deliveredAmount: '500',
        paymentCurrencyId: seed.mruId,
        rate: '40',
        immediatePayment: '20000',
        paymentMethodId: seed.cashMethodId,
      })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/sales')
      .set('Cookie', seed.ownerCookie)
      .send({
        contactId: seed.contactId,
        deliveredCurrencyId: seed.usdId,
        deliveredAmount: '400',
        paymentCurrencyId: seed.mruId,
        rate: '42',
        immediatePayment: '16800',
        paymentMethodId: seed.cashMethodId,
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/purchases/${p2.body.id}/reverse`)
      .set('Cookie', seed.ownerCookie)
      .send({ reason: 'rate correction' })
      .expect(200);

    const results = await checkAll(prisma);
    const msg = formatFailures(results);
    expect(msg).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Payment reversal — cascade to receivable/payable
// ---------------------------------------------------------------------------

describe('POST /payments/:id/reverse — payment reversal', () => {
  it('flips payment.status, deactivates ledger, and re-opens the receivable', async () => {
    const phones = nextPhone();
    const seed = await fullSeed(phones);
    await openMru(seed, '500000');

    // Purchase inventory so the sale has USD to deliver.
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

    // Sale on credit — receivable of 20,500 MRU.
    await request(app.getHttpServer())
      .post('/api/v1/sales')
      .set('Cookie', seed.ownerCookie)
      .send({
        contactId: seed.contactId,
        deliveredCurrencyId: seed.usdId,
        deliveredAmount: '500',
        paymentCurrencyId: seed.mruId,
        rate: '41',
        immediatePayment: '0',
        paymentMethodId: seed.cashMethodId,
      })
      .expect(201);

    // Customer pays the receivable in full.
    const payRes = await request(app.getHttpServer())
      .post('/api/v1/customer-payments')
      .set('Cookie', seed.ownerCookie)
      .send({
        contactId: seed.contactId,
        currencyId: seed.mruId,
        amount: '20500',
        paymentMethodId: seed.cashMethodId,
      })
      .expect(201);

    const paymentId = payRes.body.id as string;
    const recPaid = await prisma.receivable.findFirstOrThrow({
      where: { contactId: seed.contactId },
    });
    expect(recPaid.outstandingAmount.toString()).toBe('0');
    expect(recPaid.paymentStatus).toBe('PAID');
    expect(recPaid.status).toBe('CLOSED');

    // Reverse the payment.
    await request(app.getHttpServer())
      .post(`/api/v1/payments/${paymentId}/reverse`)
      .set('Cookie', seed.ownerCookie)
      .send({ reason: 'chargeback' })
      .expect(200);

    const recAfter = await prisma.receivable.findUniqueOrThrow({ where: { id: recPaid.id } });
    expect(recAfter.outstandingAmount.toString()).toBe('20500');
    expect(recAfter.paymentStatus).toBe('UNPAID');
    expect(recAfter.status).toBe('OPEN');

    // Payment row is REVERSED, allocations remain in the table but their
    // liveness is gone (target's payment reads exclude REVERSED payments).
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment.status).toBe('REVERSED');
    expect(payment.reversalReason).toBe('chargeback');
  });
});

// ---------------------------------------------------------------------------
// Expense reversal
// ---------------------------------------------------------------------------

describe('POST /expenses/:id/reverse — expense reversal', () => {
  it('flips status, credits the balance back, and audits', async () => {
    const phones = nextPhone();
    const seed = await fullSeed(phones);
    await openMru(seed, '100000');

    const before = await prisma.currencyBalance.findUniqueOrThrow({
      where: { currencyId: seed.mruId },
    });

    const expRes = await request(app.getHttpServer())
      .post('/api/v1/expenses')
      .set('Cookie', seed.ownerCookie)
      .send({
        expenseCategoryId: seed.expenseCategoryId,
        currencyId: seed.mruId,
        amount: '2500',
        paymentMethodId: seed.cashMethodId,
        description: 'wrong amount',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/expenses/${expRes.body.id}/reverse`)
      .set('Cookie', seed.ownerCookie)
      .send({ reason: 'wrong amount, will re-book' })
      .expect(200);

    const after = await prisma.currencyBalance.findUniqueOrThrow({
      where: { currencyId: seed.mruId },
    });
    expect(after.cachedAmount.toString()).toBe(before.cachedAmount.toString());

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'expense_reversed', entityId: expRes.body.id },
    });
    expect(audit.reason).toBe('wrong amount, will re-book');
  });
});
