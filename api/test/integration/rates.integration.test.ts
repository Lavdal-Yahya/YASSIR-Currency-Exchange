// P8-02..P8-04 · rate snapshot integration tests.
//
// Priority (matches phase-8.md §7):
//   1. Fetch and store creates one is_current row per non-base currency.
//   2. Second refresh flips the flag; partial unique index proves it.
//   3. Base currency (MRU) never gets a snapshot.
//   4. Per-currency provider failure doesn't take out the rest.
//   5. GET /rates returns one row per non-base currency.
//   6. GET /rates/history returns most-recent first.
//   7. POST /rates/refresh is owner-only (rate:manage).
//   8. Rate module writes to no financial table.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import argon2 from 'argon2';
import { Test, type TestingModule } from '@nestjs/testing';
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
import {
  RATE_PROVIDER,
  type RateProvider,
  type RateProviderResult,
} from '../../src/rates/rate-provider.js';
import { RatesService } from '../../src/rates/rates.service.js';
import { setupTestDb } from '../setup.js';

// Deterministic provider — the shared instance below is mutable via
// `.next` so each test can control what the next refresh returns.
class FixedRateProvider implements RateProvider {
  readonly name = 'test-fixed';
  next: RateProviderResult[] | Error = [];
  perCode: Map<string, RateProviderResult | Error> = new Map();

  async fetch(_baseCode: string, targetCodes: string[]): Promise<RateProviderResult[]> {
    // Per-code map takes precedence, then the flat `next` array.
    if (this.perCode.size > 0) {
      const out: RateProviderResult[] = [];
      for (const code of targetCodes) {
        const entry = this.perCode.get(code);
        if (!entry) continue;
        if (entry instanceof Error) continue; // silent skip
        out.push(entry);
      }
      return out;
    }
    if (this.next instanceof Error) throw this.next;
    return this.next;
  }
}

let app: INestApplication;
let module: TestingModule;
let prisma: PrismaService;
let provider: FixedRateProvider;
let rates: RatesService;

beforeAll(async () => {
  await setupTestDb();
  provider = new FixedRateProvider();
  module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(RATE_PROVIDER)
    .useValue(provider)
    .compile();
  app = module.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();
  prisma = module.get(PrismaService);
  rates = module.get(RatesService);
});

afterAll(async () => {
  await app.close();
});

let seq = 0;
function nextPhone() {
  seq += 1;
  return {
    owner: `+22291${String(seq).padStart(5, '0')}`,
    employee: `+22292${String(seq).padStart(5, '0')}`,
    ip: `10.88.${(seq >> 8) & 255}.${seq & 255}`,
  };
}

interface Seed {
  ownerCookie: string;
  employeeCookie: string;
  mruId: string;
  usdId: string;
  eurId: string;
}

async function seed(phones: { owner: string; employee: string; ip: string }): Promise<Seed> {
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

    return { mruId: mru.id, usdId: usd.id, eurId: eur.id };
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

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "audit_log", "payment", "allocation", "expense",
      "sale", "purchase", "cost_movement", "currency_ledger",
      "currency_balance", "currency_cost", "opening_balance",
      "receivable", "payable", "rate_snapshot",
      "user_role", "role_permission", "settings",
      "currency", "contact", "payment_method", "expense_category",
      "user", "role", "permission"
    RESTART IDENTITY CASCADE;
  `);
  provider.next = [];
  provider.perCode.clear();
});

// ---------------------------------------------------------------------------
// 1. Fetch and store creates one is_current row per non-base currency
// ---------------------------------------------------------------------------

describe('RatesService.refresh — fetch and store', () => {
  it('creates one is_current row per active non-base currency', async () => {
    const s = await seed(nextPhone());
    provider.next = [
      { code: 'USD', midRateMru: new Decimal('40.5') },
      { code: 'EUR', midRateMru: new Decimal('43.2') },
    ];
    const result = await rates.refresh();
    expect(result.refreshed).toBe(2);
    expect(result.failed).toBe(0);

    const rows = await prisma.rateSnapshot.findMany({ where: { isCurrent: true } });
    expect(rows).toHaveLength(2);
    const byCurrency = new Map(rows.map((r) => [r.currencyId, r]));
    const usd = byCurrency.get(s.usdId);
    const eur = byCurrency.get(s.eurId);
    if (!usd || !eur) throw new Error('expected USD + EUR snapshots');
    expect(usd.midRateMru.toString()).toBe('40.5');
    expect(eur.midRateMru.toString()).toBe('43.2');
    expect(usd.source).toBe('test-fixed');
  });
});

// ---------------------------------------------------------------------------
// 2. Second refresh flips is_current; partial unique index enforces it
// ---------------------------------------------------------------------------

describe('RatesService.refresh — flips is_current on re-fetch', () => {
  it('marks the old row is_current=false and inserts a new current row', async () => {
    const s = await seed(nextPhone());
    provider.next = [{ code: 'USD', midRateMru: new Decimal('40.5') }];
    await rates.refresh();
    provider.next = [{ code: 'USD', midRateMru: new Decimal('41.0') }];
    await rates.refresh();

    const usdRows = await prisma.rateSnapshot.findMany({
      where: { currencyId: s.usdId },
      orderBy: { fetchedAt: 'asc' },
    });
    expect(usdRows).toHaveLength(2);
    expect(usdRows[0]?.isCurrent).toBe(false);
    expect(usdRows[1]?.isCurrent).toBe(true);
    expect(usdRows[1]?.midRateMru.toString()).toBe('41');
  });

  it('rejects a direct insert of a second is_current row for the same currency', async () => {
    const s = await seed(nextPhone());
    provider.next = [{ code: 'USD', midRateMru: new Decimal('40.5') }];
    await rates.refresh();

    await expect(
      prisma.rateSnapshot.create({
        data: {
          currencyId: s.usdId,
          midRateMru: '42.0',
          source: 'manual',
          fetchedAt: new Date(),
          isCurrent: true,
        },
      }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 3. Base currency (MRU) never gets a snapshot
// ---------------------------------------------------------------------------

describe('RatesService.refresh — MRU is skipped', () => {
  it('never creates a snapshot for the base currency even if the provider returns MRU', async () => {
    const s = await seed(nextPhone());
    provider.next = [
      { code: 'MRU', midRateMru: new Decimal('1.0') },
      { code: 'USD', midRateMru: new Decimal('40.5') },
    ];
    await rates.refresh();
    const mruRows = await prisma.rateSnapshot.findMany({ where: { currencyId: s.mruId } });
    expect(mruRows).toHaveLength(0);
    const usdRows = await prisma.rateSnapshot.findMany({ where: { currencyId: s.usdId } });
    expect(usdRows).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 4. Per-currency provider failure doesn't take out the rest
// ---------------------------------------------------------------------------

describe('RatesService.refresh — partial provider outputs', () => {
  it('records EUR when USD is missing from the response and reports failed count', async () => {
    const s = await seed(nextPhone());
    provider.next = [{ code: 'EUR', midRateMru: new Decimal('43.2') }];
    const result = await rates.refresh();
    expect(result.refreshed).toBe(1);
    expect(result.failed).toBe(1);
    const eurRows = await prisma.rateSnapshot.findMany({
      where: { currencyId: s.eurId, isCurrent: true },
    });
    expect(eurRows).toHaveLength(1);
    const usdRows = await prisma.rateSnapshot.findMany({ where: { currencyId: s.usdId } });
    expect(usdRows).toHaveLength(0);
  });

  it('logs and reports all failed when the provider throws entirely', async () => {
    await seed(nextPhone());
    provider.next = new Error('rate service unreachable');
    const result = await rates.refresh();
    expect(result.refreshed).toBe(0);
    expect(result.failed).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 5. GET /rates — current snapshots
// ---------------------------------------------------------------------------

describe('GET /rates', () => {
  it('returns one row per non-base currency for an employee', async () => {
    const s = await seed(nextPhone());
    provider.next = [
      { code: 'USD', midRateMru: new Decimal('40.5') },
      { code: 'EUR', midRateMru: new Decimal('43.2') },
    ];
    await rates.refresh();

    const res = await request(app.getHttpServer())
      .get('/api/v1/rates')
      .set('Cookie', s.employeeCookie)
      .expect(200);
    const body = res.body as Array<{ currencyCode: string; midRateMru: string }>;
    expect(body).toHaveLength(2);
    const codes = new Set(body.map((r) => r.currencyCode));
    expect(codes).toEqual(new Set(['USD', 'EUR']));
  });
});

// ---------------------------------------------------------------------------
// 6. GET /rates/history — most-recent first
// ---------------------------------------------------------------------------

describe('GET /rates/history', () => {
  it('returns most-recent first respecting the limit', async () => {
    const s = await seed(nextPhone());
    for (const rate of ['40.0', '40.5', '41.0']) {
      provider.next = [{ code: 'USD', midRateMru: new Decimal(rate) }];
      await rates.refresh();
    }

    const res = await request(app.getHttpServer())
      .get(`/api/v1/rates/history?currencyId=${s.usdId}&limit=2`)
      .set('Cookie', s.ownerCookie)
      .expect(200);
    const body = res.body as Array<{ midRateMru: string; isCurrent: boolean }>;
    expect(body).toHaveLength(2);
    expect(body[0]?.midRateMru).toBe('41.00000000');
    expect(body[0]?.isCurrent).toBe(true);
    expect(body[1]?.midRateMru).toBe('40.50000000');
    expect(body[1]?.isCurrent).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. POST /rates/refresh — owner only
// ---------------------------------------------------------------------------

describe('POST /rates/refresh', () => {
  it('403s an employee without rate:manage', async () => {
    const s = await seed(nextPhone());
    provider.next = [{ code: 'USD', midRateMru: new Decimal('40.5') }];
    await request(app.getHttpServer())
      .post('/api/v1/rates/refresh')
      .set('Cookie', s.employeeCookie)
      .expect(403);
  });

  it('returns 200 with refreshed/failed counts for the owner', async () => {
    const s = await seed(nextPhone());
    provider.next = [
      { code: 'USD', midRateMru: new Decimal('40.5') },
      { code: 'EUR', midRateMru: new Decimal('43.2') },
    ];
    const res = await request(app.getHttpServer())
      .post('/api/v1/rates/refresh')
      .set('Cookie', s.ownerCookie)
      .expect(200);
    expect(res.body).toEqual({ refreshed: 2, failed: 0 });
  });
});

// ---------------------------------------------------------------------------
// 8. Rate module writes to no financial table (grep guard)
// ---------------------------------------------------------------------------

describe('rate module chokepoint guard', () => {
  it('no file in src/rates/ contains a write to a financial table', () => {
    const dir = join(process.cwd(), 'src', 'rates');
    const files = readdirSync(dir, { recursive: true, encoding: 'utf-8' });
    const forbidden = [
      /prisma\.(purchase|sale|payment|expense|currencyLedger|currencyBalance|costMovement|currencyCost)\.(create|update|delete|updateMany|deleteMany|upsert)/,
      /INSERT\s+INTO\s+"(purchase|sale|payment|expense|currency_ledger|currency_balance|cost_movement|currency_cost)"/i,
      /UPDATE\s+"(purchase|sale|payment|expense|currency_ledger|currency_balance|cost_movement|currency_cost)"/i,
      /DELETE\s+FROM\s+"(purchase|sale|payment|expense|currency_ledger|currency_balance|cost_movement|currency_cost)"/i,
    ];
    for (const f of files) {
      const full = join(dir, f);
      let content = '';
      try {
        content = readFileSync(full, 'utf-8');
      } catch {
        continue; // it was a directory
      }
      for (const pattern of forbidden) {
        expect(pattern.test(content), `${f} contains forbidden write: ${pattern}`).toBe(false);
      }
    }
  });
});
