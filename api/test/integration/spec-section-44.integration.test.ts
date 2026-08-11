// Spec §44 · CI acceptance scenario — the fixed fixture. Every DoD
// figure is asserted BY DIRECT POSTGRES QUERY, not by reading the API
// response, per phase-4.md §7. Editing these expected values requires a
// paired D-0xx entry (phase-4.md §3, `SPEC_44_EXPECTED`).

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/bootstrap.js';
import { PrismaService } from '../../src/common/prisma.service.js';
import { setupTestDb } from '../setup.js';
import { seedSpec44, walkSpec44, SPEC_44_EXPECTED } from '../fixtures/spec-section-44.js';
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

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "audit_log",
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

describe('spec §44 · acceptance scenario', () => {
  it('two purchases and a partially paid sale produce the DoD figures — verified by direct query', async () => {
    const phones = {
      owner: '+22240000001',
      employee: '+22240000002',
    };
    const seed = await seedSpec44(prisma, app, phones);
    const ownerCookie = await seed.cookie(phones.owner, '10.44.99.1');
    const walked = await walkSpec44(app, seed, ownerCookie);

    // --- USD balance ------------------------------------------------------
    const usdBalance = await prisma.currencyBalance.findUniqueOrThrow({
      where: { currencyId: seed.usdId },
    });
    expect(new Decimal(usdBalance.cachedAmount.toString()).toString()).toBe(
      SPEC_44_EXPECTED.usdBalance,
    );

    // Cross-check via ledger sum (INV-1 shape) — asserting DB truth,
    // not the cache.
    const ledgerSum = await prisma.$queryRaw<{ sum: string }[]>`
      SELECT COALESCE(SUM(CASE WHEN "direction" = 'CREDIT' THEN "amount" ELSE -"amount" END), 0)::text AS sum
      FROM "currency_ledger"
      WHERE "currency_id" = ${seed.usdId}::uuid AND "is_active" = true
    `;
    const usdSum = ledgerSum[0];
    if (!usdSum) throw new Error('unreachable: usd ledger sum row missing');
    expect(new Decimal(usdSum.sum).toString()).toBe(SPEC_44_EXPECTED.usdBalance);

    // --- MRU balance ------------------------------------------------------
    const mruBalance = await prisma.currencyBalance.findUniqueOrThrow({
      where: { currencyId: seed.mruId },
    });
    expect(new Decimal(mruBalance.cachedAmount.toString()).toString()).toBe(
      SPEC_44_EXPECTED.mruBalance,
    );

    // --- USD WAC ----------------------------------------------------------
    const usdCost = await prisma.currencyCost.findUniqueOrThrow({
      where: { currencyId: seed.usdId },
    });
    expect(new Decimal(usdCost.cachedAvgMru.toString()).toString()).toBe(
      SPEC_44_EXPECTED.usdWacMru,
    );

    // --- Sale snapshot ----------------------------------------------------
    const sale = await prisma.sale.findUniqueOrThrow({ where: { id: walked.saleId } });
    expect(sale.costOfCurrencySoldMru.toString()).toBe(SPEC_44_EXPECTED.saleCostOfCurrencySoldMru);
    expect(sale.grossProfitMru.toString()).toBe(SPEC_44_EXPECTED.saleGrossProfitMru);
    expect(sale.outstandingAmount.toString()).toBe(SPEC_44_EXPECTED.saleOutstandingMru);

    // --- Receivable from the partially-paid sale -------------------------
    const receivable = await prisma.receivable.findFirstOrThrow({
      where: { sourceType: 'sale', sourceId: walked.saleId },
    });
    expect(receivable.origin).toBe('TRADE');
    expect(receivable.outstandingAmount.toString()).toBe(SPEC_44_EXPECTED.saleOutstandingMru);
    expect(receivable.currencyId).toBe(seed.mruId);
  });
});
