// Spec §44 acceptance-scenario fixture.
//
// This is a fixed CI fixture (phase-4.md §3): the expected values MUST
// NOT be edited to match new behaviour. If the fixture goes red, the
// behaviour is wrong.
//
// Concrete walk (chosen so all four DoD figures match a spec §44 read
// of "two purchases plus one sale"):
//
//   opening MRU = 464,000
//     — funds the two purchases; USD opens at 0
//
//   Purchase 1: 6,000 USD @ 39.00 MRU/USD, fully paid immediate
//     → +6,000 USD, −234,000 MRU
//     → cachedAvgMru(USD) becomes 39.00 exactly
//
//   Purchase 2: 4,000 USD @ 39.00 MRU/USD, fully paid immediate
//     → +4,000 USD, −156,000 MRU
//     → cachedAvgMru(USD) stays 39.00 (WAC of two equal-rate acquisitions)
//
//   Sale:      4,000 USD @ 41.00 MRU/USD, 100,000 MRU immediate,
//              64,000 MRU outstanding (receivable)
//     → −4,000 USD, +100,000 MRU
//     → cost_of_currency_sold_mru = 4,000 × 39.00 = 156,000
//     → gross_profit_mru          = 164,000 − 156,000 =   8,000
//
//   Final:  USD balance = 6,000
//           MRU balance = 464,000 − 234,000 − 156,000 + 100,000 = 174,000
//           WAC(USD)    = 39.00
//           gross profit on sale = 8,000 MRU
//
// Any drift and the assertions below turn red before the DoD does.

import type { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  ALL_PERMISSIONS,
  EMPLOYEE_PERMISSIONS,
  OWNER_PERMISSIONS,
  ROLE_CODES,
} from '../../src/common/permissions.js';

// Frozen expected values. Any change requires a matching D-0xx entry
// per the phase-4 DoD.
export const SPEC_44_EXPECTED = {
  usdBalance: '6000',
  mruBalance: '174000',
  usdWacMru: '39',
  saleCostOfCurrencySoldMru: '156000',
  saleGrossProfitMru: '8000',
  saleOutstandingMru: '64000',
} as const;

export interface Spec44Seed {
  ownerId: string;
  employeeId: string;
  mruId: string;
  usdId: string;
  contactId: string;
  cashMethodId: string;
  ownerPhone: string;
  employeePhone: string;
  cookie: (phone: string, ip: string) => Promise<string>;
}

/**
 * Seed the master data (owner + employee + roles/permissions, MRU +
 * USD, settings, a walk-in customer contact, cash payment method) and
 * pre-book an opening balance of 464,000 MRU. Returns handles the
 * tests use to hit the trade endpoints.
 *
 * The opening balance is written via the HTTP endpoint so it goes
 * through LedgerService (rather than raw INSERTs that would leave the
 * cost cache empty for the base currency and skip the chokepoint).
 */
export async function seedSpec44(
  prisma: PrismaClient,
  app: INestApplication,
  phones: { owner: string; employee: string },
): Promise<Spec44Seed> {
  const pinHash = await argon2.hash('1234', { type: argon2.argon2id });

  const seed = await prisma.$transaction(async (tx) => {
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
    const ownerUser = await tx.user.create({
      data: { phone: phones.owner, pinHash, fullName: 'Owner' },
    });
    await tx.userRole.create({ data: { userId: ownerUser.id, roleId: ownerRole.id } });
    const employeeUser = await tx.user.create({
      data: { phone: phones.employee, pinHash, fullName: 'Employee' },
    });
    await tx.userRole.create({ data: { userId: employeeUser.id, roleId: employeeRole.id } });

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
      data: { name: 'Spec §44 customer', isCustomer: true, isSupplier: false },
    });
    const cash = await tx.paymentMethod.create({
      data: { code: 'CASH', labelFr: 'Espèces', labelAr: 'نقداً', requiresNote: false },
    });

    return {
      ownerId: ownerUser.id,
      employeeId: employeeUser.id,
      mruId: mru.id,
      usdId: usd.id,
      contactId: contact.id,
      cashMethodId: cash.id,
    };
  });

  const cookie = async (phone: string, ip: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ phone, pin: '1234' })
      .expect(204);
    const setCookie = res.headers['set-cookie'];
    const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    if (!raw) throw new Error('login did not set a cookie');
    return raw.split(';')[0] ?? '';
  };

  // Opening balance flows through the openings endpoint → LedgerService.
  const ownerCookie = await cookie(phones.owner, '10.44.0.1');
  await request(app.getHttpServer())
    .post('/api/v1/openings/currency')
    .set('Cookie', ownerCookie)
    .send({
      currencyId: seed.mruId,
      quantity: '464000',
      openingAvgCostMru: '1',
      effectiveDate: '2026-08-01',
    })
    .expect(201);

  return {
    ...seed,
    ownerPhone: phones.owner,
    employeePhone: phones.employee,
    cookie,
  };
}

/**
 * Walk the two purchases and the sale that make up spec §44. Callers
 * pass the seed returned by seedSpec44 and the owner's session cookie;
 * this function returns the sale row for follow-up assertions.
 */
export async function walkSpec44(
  app: INestApplication,
  seed: Spec44Seed,
  ownerCookie: string,
): Promise<{ purchase1Id: string; purchase2Id: string; saleId: string }> {
  // Purchase 1 — 6,000 USD @ 39.00, fully paid.
  const p1 = await request(app.getHttpServer())
    .post('/api/v1/purchases')
    .set('Cookie', ownerCookie)
    .send({
      contactId: seed.contactId,
      deliveredCurrencyId: seed.usdId,
      deliveredAmount: '6000',
      paymentCurrencyId: seed.mruId,
      rate: '39.00',
      immediatePayment: '234000',
      paymentMethodId: seed.cashMethodId,
    })
    .expect(201);

  // Purchase 2 — 4,000 USD @ 39.00, fully paid. WAC stays at 39.00.
  const p2 = await request(app.getHttpServer())
    .post('/api/v1/purchases')
    .set('Cookie', ownerCookie)
    .send({
      contactId: seed.contactId,
      deliveredCurrencyId: seed.usdId,
      deliveredAmount: '4000',
      paymentCurrencyId: seed.mruId,
      rate: '39.00',
      immediatePayment: '156000',
      paymentMethodId: seed.cashMethodId,
    })
    .expect(201);

  // Sale — 4,000 USD @ 41.00, immediate 100,000 MRU, outstanding
  // 64,000 MRU (receivable).
  const s = await request(app.getHttpServer())
    .post('/api/v1/sales')
    .set('Cookie', ownerCookie)
    .send({
      contactId: seed.contactId,
      deliveredCurrencyId: seed.usdId,
      deliveredAmount: '4000',
      paymentCurrencyId: seed.mruId,
      rate: '41.00',
      immediatePayment: '100000',
      paymentMethodId: seed.cashMethodId,
    })
    .expect(201);

  return {
    purchase1Id: p1.body.id,
    purchase2Id: p2.body.id,
    saleId: s.body.id,
  };
}
