// P3-07 · LedgerService + CostEngine end-to-end tests.
//
// Priority order per docs/phases/phase-3.md §6: the concurrent test
// runs first because concurrency tests are the ones people skip when
// the sprint gets tight. The rest cover the numbered contract in
// LedgerService.apply and the WAC book in CostEngine.
//
// Uses the Nest testing module so DI resolves exactly the way it does
// in production, and a scratch DB reset via prisma migrate reset. Each
// test starts from an empty ledger and re-seeds only the master data
// it needs.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/common/prisma.service.js';
import { LedgerService } from '../../src/ledger/ledger.service.js';
import { CostEngine } from '../../src/ledger/cost.engine.js';
import { Decimal } from '../../src/common/money.js';
import {
  InsufficientBalanceError,
  LedgerContractError,
  NegativeBalanceOverrideDeniedError,
  PaymentMethodNoteRequiredError,
} from '../../src/common/errors/ledger.errors.js';
import { setupTestDb } from '../setup.js';

let module: TestingModule;
let prisma: PrismaService;
let ledger: LedgerService;
let costs: CostEngine;

beforeAll(async () => {
  await setupTestDb();
  module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  await module.init();
  prisma = module.get(PrismaService);
  ledger = module.get(LedgerService);
  costs = module.get(CostEngine);
});

afterAll(async () => {
  await module.close();
});

interface Fixtures {
  mruId: string;
  usdId: string;
  eurId: string;
  userId: string;
  cashMethodId: string; // requires_note = false
  otherMethodId: string; // requires_note = true
}

// Fresh master data per test. Ledger tables are truncated with CASCADE
// so their dependants (cost_movement, currency_balance, currency_cost)
// go with them.
async function seed(): Promise<Fixtures> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "audit_log",
      "cost_movement",
      "currency_ledger",
      "currency_balance",
      "currency_cost",
      "user_role",
      "role_permission",
      "settings",
      "currency",
      "payment_method",
      "user",
      "role",
      "permission"
    RESTART IDENTITY CASCADE;
  `);
  const mru = await prisma.currency.create({
    data: { code: 'MRU', name: 'Ouguiya', decimalPlaces: 2 },
  });
  const usd = await prisma.currency.create({
    data: { code: 'USD', name: 'US Dollar', decimalPlaces: 2 },
  });
  const eur = await prisma.currency.create({
    data: { code: 'EUR', name: 'Euro', decimalPlaces: 2 },
  });
  await prisma.settings.create({
    data: { id: 1, baseCurrencyId: mru.id, businessTimezone: 'Africa/Nouakchott' },
  });
  const user = await prisma.user.create({
    data: { phone: `+22200${Date.now() % 100000}`, pinHash: 'x', fullName: 'Test' },
  });
  const cash = await prisma.paymentMethod.create({
    data: { code: 'CASH', labelFr: 'Espèces', labelAr: 'نقداً', requiresNote: false },
  });
  const other = await prisma.paymentMethod.create({
    data: { code: 'OTHER', labelFr: 'Autre', labelAr: 'أخرى', requiresNote: true },
  });
  return {
    mruId: mru.id,
    usdId: usd.id,
    eurId: eur.id,
    userId: user.id,
    cashMethodId: cash.id,
    otherMethodId: other.id,
  };
}

beforeEach(async () => {
  await seed();
});

// Convenience builder — cuts the noise in each test.
function movement(
  f: Fixtures,
  currencyId: string,
  direction: 'CREDIT' | 'DEBIT',
  amount: string,
  extra: Partial<Parameters<LedgerService['apply']>[1][number]> = {},
) {
  return {
    currencyId,
    direction,
    amount,
    sourceType: 'opening_balance' as const,
    transactionDate: new Date('2026-08-04T10:00:00Z'),
    description: 'test movement',
    createdByUserId: f.userId,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// The concurrent test comes first. If FOR UPDATE ordering is wrong, this
// is the test that turns red.
// ---------------------------------------------------------------------------

describe('LedgerService.apply — concurrent', () => {
  it('two connections spending the same USD balance: exactly one wins', async () => {
    const f = await seed();

    // Seed 100 USD so a 60 USD spend can succeed once but not twice.
    await prisma.$transaction(async (tx) => {
      await ledger.apply(tx, [movement(f, f.usdId, 'CREDIT', '100', { unitCostMru: '39.00' })]);
    });

    // Two independent connections so they hold different tx locks.
    const clientA = new PrismaClient();
    const clientB = new PrismaClient();
    try {
      const spend = (client: PrismaClient) =>
        client.$transaction(
          async (tx) =>
            ledger.apply(tx, [
              {
                currencyId: f.usdId,
                direction: 'DEBIT',
                amount: '60',
                sourceType: 'opening_balance',
                transactionDate: new Date('2026-08-04T10:00:00Z'),
                description: 'concurrent spend',
                createdByUserId: f.userId,
              },
            ]),
          { timeout: 15_000, maxWait: 15_000 },
        );

      const [r1, r2] = await Promise.allSettled([spend(clientA), spend(clientB)]);

      const outcomes = [r1, r2].map((r) => r.status);
      expect(outcomes.sort()).toEqual(['fulfilled', 'rejected']);

      const rejection = (r1.status === 'rejected' ? r1 : r2) as PromiseRejectedResult;
      expect(rejection.reason).toBeInstanceOf(InsufficientBalanceError);

      // Ledger + balance are consistent: 100 CREDIT + 60 DEBIT = 40.
      const balance = await prisma.currencyBalance.findUniqueOrThrow({
        where: { currencyId: f.usdId },
      });
      expect(balance.cachedAmount.toString()).toBe('40');
      const ledgerRows = await prisma.currencyLedger.count({ where: { currencyId: f.usdId } });
      expect(ledgerRows).toBe(2); // one credit, one accepted debit
    } finally {
      await clientA.$disconnect();
      await clientB.$disconnect();
    }
  });
});

// ---------------------------------------------------------------------------
// End-to-end shape checks.
// ---------------------------------------------------------------------------

describe('LedgerService.apply — single writes', () => {
  it('acquires a non-base currency and cascades to cost + balance', async () => {
    const f = await seed();
    await prisma.$transaction(async (tx) => {
      await ledger.apply(tx, [movement(f, f.usdId, 'CREDIT', '10000', { unitCostMru: '39.00' })]);
    });

    const balance = await prisma.currencyBalance.findUniqueOrThrow({
      where: { currencyId: f.usdId },
    });
    expect(balance.cachedAmount.toString()).toBe('10000');

    const cost = await prisma.currencyCost.findUniqueOrThrow({
      where: { currencyId: f.usdId },
    });
    expect(cost.cachedAvgMru.toString()).toBe('39');
    expect(cost.cachedQuantity.toString()).toBe('10000');

    const movements = await prisma.costMovement.findMany({ where: { currencyId: f.usdId } });
    expect(movements).toHaveLength(1);
    const first = movements[0];
    if (!first) throw new Error('unreachable');
    expect(first.kind).toBe('ACQUISITION');
    expect(first.unitCostMru.toString()).toBe('39');
  });

  it('multi-currency batch writes both and locks in sorted order', async () => {
    const f = await seed();
    const written = await prisma.$transaction(async (tx) => {
      return ledger.apply(tx, [
        movement(f, f.eurId, 'CREDIT', '500', { unitCostMru: '42.00' }),
        movement(f, f.usdId, 'CREDIT', '1000', { unitCostMru: '39.00' }),
      ]);
    });

    expect(written).toHaveLength(2);
    const usdBal = await prisma.currencyBalance.findUniqueOrThrow({
      where: { currencyId: f.usdId },
    });
    const eurBal = await prisma.currencyBalance.findUniqueOrThrow({
      where: { currencyId: f.eurId },
    });
    expect(usdBal.cachedAmount.toString()).toBe('1000');
    expect(eurBal.cachedAmount.toString()).toBe('500');
  });

  it('rollback on mid-transaction failure leaves no ledger row', async () => {
    const f = await seed();
    await expect(
      prisma.$transaction(async (tx) => {
        await ledger.apply(tx, [movement(f, f.usdId, 'CREDIT', '100', { unitCostMru: '39.00' })]);
        throw new Error('user cancelled mid-tx');
      }),
    ).rejects.toThrow('user cancelled mid-tx');

    const rows = await prisma.currencyLedger.count({ where: { currencyId: f.usdId } });
    expect(rows).toBe(0);
    const balance = await prisma.currencyBalance.findUnique({
      where: { currencyId: f.usdId },
    });
    expect(balance).toBeNull();
  });

  it('refuses an empty batch with LedgerContractError', async () => {
    await expect(prisma.$transaction((tx) => ledger.apply(tx, []))).rejects.toBeInstanceOf(
      LedgerContractError,
    );
  });
});

// ---------------------------------------------------------------------------
// Validation shape — the contract lives in error data.
// ---------------------------------------------------------------------------

describe('LedgerService.apply — insufficient balance & override policy', () => {
  it('carries available / requested in the error payload', async () => {
    const f = await seed();
    await prisma.$transaction((tx) =>
      ledger.apply(tx, [movement(f, f.usdId, 'CREDIT', '100', { unitCostMru: '39.00' })]),
    );

    try {
      await prisma.$transaction((tx) => ledger.apply(tx, [movement(f, f.usdId, 'DEBIT', '250')]));
      throw new Error('expected InsufficientBalanceError');
    } catch (err) {
      expect(err).toBeInstanceOf(InsufficientBalanceError);
      const e = err as InsufficientBalanceError;
      expect(e.data).toMatchObject({
        currencyId: f.usdId,
        currencyCode: 'USD',
        available: '100.00',
        requested: '250.00',
      });
    }
  });

  it('permits the base-currency override when caller has the permission', async () => {
    const f = await seed();
    // Overdraw MRU by 50 to observe the override path.
    await prisma.$transaction((tx) =>
      ledger.apply(tx, [movement(f, f.mruId, 'DEBIT', '50')], {
        negativeBalanceOverride: { reason: 'petty cash draw', actorHasPermission: true },
      }),
    );

    const bal = await prisma.currencyBalance.findUniqueOrThrow({
      where: { currencyId: f.mruId },
    });
    expect(bal.cachedAmount.toString()).toBe('-50');

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'balance_override_applied' },
    });
    expect(audit?.reason).toBe('petty cash draw');
  });

  it('refuses the override on a non-base currency, regardless of permission', async () => {
    const f = await seed();
    await prisma.$transaction((tx) =>
      ledger.apply(tx, [movement(f, f.usdId, 'CREDIT', '50', { unitCostMru: '39.00' })]),
    );
    try {
      await prisma.$transaction((tx) =>
        ledger.apply(tx, [movement(f, f.usdId, 'DEBIT', '100')], {
          negativeBalanceOverride: { reason: 'anything', actorHasPermission: true },
        }),
      );
      throw new Error('expected NegativeBalanceOverrideDeniedError');
    } catch (err) {
      expect(err).toBeInstanceOf(NegativeBalanceOverrideDeniedError);
      expect((err as NegativeBalanceOverrideDeniedError).data.reason).toBe('non_base_currency');
    }
  });

  it('refuses the override on MRU when the caller lacks the permission', async () => {
    const f = await seed();
    try {
      await prisma.$transaction((tx) =>
        ledger.apply(tx, [movement(f, f.mruId, 'DEBIT', '10')], {
          negativeBalanceOverride: { reason: 'nope', actorHasPermission: false },
        }),
      );
      throw new Error('expected NegativeBalanceOverrideDeniedError');
    } catch (err) {
      expect(err).toBeInstanceOf(NegativeBalanceOverrideDeniedError);
      expect((err as NegativeBalanceOverrideDeniedError).data.reason).toBe('not_owner');
    }
  });

  it('refuses the override on MRU when the reason is empty', async () => {
    const f = await seed();
    try {
      await prisma.$transaction((tx) =>
        ledger.apply(tx, [movement(f, f.mruId, 'DEBIT', '10')], {
          negativeBalanceOverride: { reason: '   ', actorHasPermission: true },
        }),
      );
      throw new Error('expected NegativeBalanceOverrideDeniedError');
    } catch (err) {
      expect(err).toBeInstanceOf(NegativeBalanceOverrideDeniedError);
      expect((err as NegativeBalanceOverrideDeniedError).data.reason).toBe('reason_required');
    }
  });
});

// ---------------------------------------------------------------------------
// D-020 note enforcement.
// ---------------------------------------------------------------------------

describe('LedgerService.apply — payment method / note', () => {
  it('accepts a movement with a requires_note method + a non-empty note', async () => {
    const f = await seed();
    await prisma.$transaction((tx) =>
      ledger.apply(tx, [
        movement(f, f.mruId, 'CREDIT', '10', {
          paymentMethodId: f.otherMethodId,
          note: 'walk-in receipt #234',
          sourceType: 'opening_balance',
        }),
      ]),
    );
    const row = await prisma.currencyLedger.findFirstOrThrow({ where: { currencyId: f.mruId } });
    expect(row.paymentMethodId).toBe(f.otherMethodId);
    expect(row.note).toBe('walk-in receipt #234');
  });

  it('rejects a requires_note method with an empty note', async () => {
    const f = await seed();
    await expect(
      prisma.$transaction((tx) =>
        ledger.apply(tx, [
          movement(f, f.mruId, 'CREDIT', '10', {
            paymentMethodId: f.otherMethodId,
            note: '',
          }),
        ]),
      ),
    ).rejects.toBeInstanceOf(PaymentMethodNoteRequiredError);
  });
});

// ---------------------------------------------------------------------------
// CostEngine — the WAC book.
// ---------------------------------------------------------------------------

describe('CostEngine — weighted-average cost', () => {
  it('computes the classical WAC across two acquisitions at different rates', async () => {
    const f = await seed();
    // Buy 1,000 USD at 40 MRU/USD → cost = 40,000 MRU.
    // Buy 1,000 USD at 42 MRU/USD → cost = 42,000 MRU.
    // WAC should be 41 MRU/USD, quantity 2,000.
    await prisma.$transaction((tx) =>
      ledger.apply(tx, [movement(f, f.usdId, 'CREDIT', '1000', { unitCostMru: '40.00' })]),
    );
    await prisma.$transaction((tx) =>
      ledger.apply(tx, [movement(f, f.usdId, 'CREDIT', '1000', { unitCostMru: '42.00' })]),
    );

    const cost = await prisma.currencyCost.findUniqueOrThrow({
      where: { currencyId: f.usdId },
    });
    expect(new Decimal(cost.cachedAvgMru.toString()).toString()).toBe('41');
    expect(cost.cachedQuantity.toString()).toBe('2000');
  });

  it('books a disposal at cost when disposalValueMru is omitted', async () => {
    const f = await seed();
    await prisma.$transaction((tx) =>
      ledger.apply(tx, [movement(f, f.usdId, 'CREDIT', '100', { unitCostMru: '40.00' })]),
    );
    await prisma.$transaction((tx) => ledger.apply(tx, [movement(f, f.usdId, 'DEBIT', '30')]));

    const cost = await prisma.currencyCost.findUniqueOrThrow({
      where: { currencyId: f.usdId },
    });
    expect(cost.cachedAvgMru.toString()).toBe('40'); // WAC unchanged
    expect(cost.cachedQuantity.toString()).toBe('70');
    const disposal = await prisma.costMovement.findFirstOrThrow({
      where: { currencyId: f.usdId, kind: 'DISPOSAL' },
    });
    expect(disposal.realizedPnlMru?.toString()).toBe('0');
  });

  it('records realized P&L when disposalValueMru is supplied', async () => {
    const f = await seed();
    // Buy 100 USD at 40 (cost 4,000 MRU). Sell 100 USD for 4,500 MRU
    // (equivalent to 45 MRU/USD spot). Realized P&L = 500 MRU.
    await prisma.$transaction((tx) =>
      ledger.apply(tx, [movement(f, f.usdId, 'CREDIT', '100', { unitCostMru: '40.00' })]),
    );
    await prisma.$transaction(async (tx) => {
      // Disposal via LedgerService.apply — spec disposalValueMru inside
      // the CostContext via an extra field on the movement. In P4 the
      // sale service builds the paired MRU credit + USD debit; here we
      // just call CostEngine directly for the disposal side.
      const entry = await tx.currencyLedger.create({
        data: {
          currencyId: f.usdId,
          direction: 'DEBIT',
          amount: '100',
          sourceType: 'sale',
          sourceId: f.userId, // arbitrary uuid for the source
          transactionDate: new Date('2026-08-04T11:00:00Z'),
          description: 'direct-disposal test',
          createdByUserId: f.userId,
        },
      });
      await tx.currencyBalance.update({
        where: { currencyId: f.usdId },
        data: { cachedAmount: '0' },
      });
      await costs.apply(tx, entry, { baseCurrencyId: f.mruId, disposalValueMru: '4500' });
    });

    const disposal = await prisma.costMovement.findFirstOrThrow({
      where: { currencyId: f.usdId, kind: 'DISPOSAL' },
    });
    expect(disposal.realizedPnlMru?.toString()).toBe('500');
  });

  it('LedgerService.apply forwards disposalValueMru to CostEngine (P4 prerequisite)', async () => {
    // Regression for the pre-P4 gap: the previous test above proves
    // CostEngine records realized P&L when called directly, but a bug
    // in LedgerService dropped the field before it reached the engine.
    // Trade services build Movement[] with disposalValueMru and expect
    // it to survive the trip.
    const f = await seed();
    await prisma.$transaction((tx) =>
      ledger.apply(tx, [movement(f, f.usdId, 'CREDIT', '100', { unitCostMru: '40.00' })]),
    );
    await prisma.$transaction((tx) =>
      ledger.apply(tx, [movement(f, f.usdId, 'DEBIT', '100', { disposalValueMru: '4500' })]),
    );
    const disposal = await prisma.costMovement.findFirstOrThrow({
      where: { currencyId: f.usdId, kind: 'DISPOSAL' },
    });
    expect(disposal.realizedPnlMru?.toString()).toBe('500');
  });

  it('resets WAC to 0 when quantity hits 0', async () => {
    const f = await seed();
    await prisma.$transaction((tx) =>
      ledger.apply(tx, [movement(f, f.usdId, 'CREDIT', '50', { unitCostMru: '39.00' })]),
    );
    await prisma.$transaction((tx) => ledger.apply(tx, [movement(f, f.usdId, 'DEBIT', '50')]));
    const cost = await prisma.currencyCost.findUniqueOrThrow({
      where: { currencyId: f.usdId },
    });
    expect(cost.cachedAvgMru.toString()).toBe('0');
    expect(cost.cachedQuantity.toString()).toBe('0');
  });

  it('MRU movements do not create cost_movement rows', async () => {
    const f = await seed();
    await prisma.$transaction((tx) => ledger.apply(tx, [movement(f, f.mruId, 'CREDIT', '10000')]));
    const rows = await prisma.costMovement.count({ where: { currencyId: f.mruId } });
    expect(rows).toBe(0);
    const cost = await prisma.currencyCost.findUnique({ where: { currencyId: f.mruId } });
    expect(cost).toBeNull(); // no cache row either — MRU is skipped
  });

  it('replay() matches incremental apply() for a fixture batch', async () => {
    const f = await seed();
    // Three acquisitions at varied rates, one disposal.
    for (const [amt, rate] of [
      ['100', '38.00'],
      ['200', '40.00'],
      ['150', '42.00'],
    ] as const) {
      await prisma.$transaction((tx) =>
        ledger.apply(tx, [movement(f, f.usdId, 'CREDIT', amt, { unitCostMru: rate })]),
      );
    }
    await prisma.$transaction((tx) => ledger.apply(tx, [movement(f, f.usdId, 'DEBIT', '100')]));

    const before = await prisma.currencyCost.findUniqueOrThrow({
      where: { currencyId: f.usdId },
    });

    // Clobber the cache to prove replay() rebuilds it from scratch.
    await prisma.currencyCost.update({
      where: { currencyId: f.usdId },
      data: { cachedAvgMru: '0', cachedQuantity: '0' },
    });
    await prisma.$transaction((tx) => costs.replay(tx, f.usdId));

    const after = await prisma.currencyCost.findUniqueOrThrow({
      where: { currencyId: f.usdId },
    });
    expect(after.cachedAvgMru.toString()).toBe(before.cachedAvgMru.toString());
    expect(after.cachedQuantity.toString()).toBe(before.cachedQuantity.toString());
  });
});
