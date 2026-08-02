// Idempotent seed — safe to re-run on any environment.
//
//   P1-04  · this file. Permissions, OWNER + EMPLOYEE roles, a bootstrap
//            owner user whose PIN is read from BOOTSTRAP_OWNER_PIN
//            (default `1234` in dev, hard-required in production).
//   P2-01  · MRU/USD/EUR currency rows (MRU first, base).
//   P2-05  · payment_method: CASH / BANKILY / MASRIVI / SEDAD / OTHER (D-020).
//   P2-02  · settings row (id=1) with MRU as base.
//
// Run: `npm --workspace api run seed`
// Prod: BOOTSTRAP_OWNER_PIN is required; the seed refuses to run without it.

import argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';
import {
  ALL_PERMISSIONS,
  EMPLOYEE_PERMISSIONS,
  OWNER_PERMISSIONS,
  ROLE_CODES,
} from '../src/common/permissions.js';

const prisma = new PrismaClient();

const OWNER_PHONE = process.env.BOOTSTRAP_OWNER_PHONE ?? '+22200000000';
const OWNER_NAME = process.env.BOOTSTRAP_OWNER_NAME ?? 'Bootstrap Owner';
const OWNER_PIN =
  process.env.BOOTSTRAP_OWNER_PIN ?? (process.env.NODE_ENV === 'production' ? '' : '1234');

async function main(): Promise<void> {
  if (!OWNER_PIN) {
    throw new Error('BOOTSTRAP_OWNER_PIN is required in production. Set it and re-run the seed.');
  }
  if (!/^\d{4,8}$/.test(OWNER_PIN)) {
    throw new Error('BOOTSTRAP_OWNER_PIN must be 4-8 digits.');
  }

  await prisma.$transaction(async (tx) => {
    // Currencies (P2-01) — MRU first because the settings row (P2-02) will
    // FK to it. Idempotent upsert by code; leaves any operator-added
    // currencies alone. `decimalPlaces` follows spec §36 conventions.
    for (const c of [
      { code: 'MRU', name: 'Ouguiya', symbol: 'UM', decimalPlaces: 2 },
      { code: 'USD', name: 'US Dollar', symbol: '$', decimalPlaces: 2 },
      { code: 'EUR', name: 'Euro', symbol: '€', decimalPlaces: 2 },
    ] as const) {
      await tx.currency.upsert({
        where: { code: c.code },
        create: c,
        update: {},
      });
    }

    // Settings (P2-02) — one row, id=1, base=MRU. If the row already
    // exists we leave every field alone (operators can change the tz
    // via the API without a re-seed clobbering their choice).
    const mru = await tx.currency.findUniqueOrThrow({ where: { code: 'MRU' } });
    await tx.settings.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        baseCurrencyId: mru.id,
        businessTimezone: process.env.BUSINESS_TZ ?? 'Africa/Nouakchott',
      },
      update: {},
    });

    // Permissions — upsert by code so re-runs with new permission codes only
    // insert what is missing. Deletions are deliberate: an old code no longer
    // in ALL_PERMISSIONS is left in the DB with a warning, so a rename does
    // not silently strip a role.
    for (const code of ALL_PERMISSIONS) {
      await tx.permission.upsert({
        where: { code },
        create: { code },
        update: {},
      });
    }
    const missing = await tx.permission.findMany({
      where: { code: { notIn: [...ALL_PERMISSIONS] } },
      select: { code: true },
    });
    for (const { code } of missing) {
      console.warn(
        `seed: permission "${code}" exists in the DB but is not in common/permissions.ts. Left in place.`,
      );
    }

    // Roles — OWNER, EMPLOYEE. Labels are the ones displayed on the
    // permission matrix in P2-11.
    const owner = await tx.role.upsert({
      where: { code: ROLE_CODES.OWNER },
      create: { code: ROLE_CODES.OWNER, labelFr: 'Propriétaire', labelAr: 'المالك' },
      update: { labelFr: 'Propriétaire', labelAr: 'المالك' },
    });
    const employee = await tx.role.upsert({
      where: { code: ROLE_CODES.EMPLOYEE },
      create: { code: ROLE_CODES.EMPLOYEE, labelFr: 'Employé', labelAr: 'موظف' },
      update: { labelFr: 'Employé', labelAr: 'موظف' },
    });

    // Role-permission mapping — recomputed from source of truth each run.
    // Delete rows that no longer belong (a permission removed from
    // EMPLOYEE_PERMISSIONS should not stay granted), insert the new set.
    await syncRolePermissions(tx, owner.id, OWNER_PERMISSIONS);
    await syncRolePermissions(tx, employee.id, EMPLOYEE_PERMISSIONS);

    // Bootstrap owner user — only created if no user exists with this
    // phone. Never overwrites an existing PIN.
    const existing = await tx.user.findUnique({ where: { phone: OWNER_PHONE } });
    if (!existing) {
      const pinHash = await argon2.hash(OWNER_PIN, { type: argon2.argon2id });
      const user = await tx.user.create({
        data: {
          phone: OWNER_PHONE,
          pinHash,
          fullName: OWNER_NAME,
        },
      });
      await tx.userRole.create({
        data: { userId: user.id, roleId: owner.id },
      });
      console.warn(
        `seed: created bootstrap owner user (phone=${OWNER_PHONE}). Change the PIN on first login.`,
      );
    } else {
      console.warn(
        `seed: owner user already exists (phone=${OWNER_PHONE}); leaving PIN untouched.`,
      );
    }
  });
}

async function syncRolePermissions(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  roleId: string,
  codes: readonly string[],
): Promise<void> {
  const perms = await tx.permission.findMany({
    where: { code: { in: [...codes] } },
    select: { id: true, code: true },
  });
  const targetIds = new Set(perms.map((p) => p.id));

  // Remove grants that no longer belong.
  await tx.rolePermission.deleteMany({
    where: { roleId, permissionId: { notIn: [...targetIds] } },
  });
  // Insert grants that are missing.
  for (const id of targetIds) {
    await tx.rolePermission.upsert({
      where: { roleId_permissionId: { roleId, permissionId: id } },
      create: { roleId, permissionId: id },
      update: {},
    });
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
