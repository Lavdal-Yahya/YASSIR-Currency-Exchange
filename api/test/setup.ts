// Integration tests need a real Postgres. This helper resets the DB
// once per suite invocation via `prisma migrate reset --force` and gives
// tests a Prisma client already scoped to the test schema.
//
// Usage in a test file:
//   const { prisma } = await setupTestDb();
//   afterAll(() => prisma.$disconnect());

import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

export async function setupTestDb(): Promise<{ prisma: PrismaClient }> {
  execSync('npx prisma migrate reset --force --skip-seed --skip-generate', {
    stdio: 'ignore',
    env: process.env,
  });
  const prisma = new PrismaClient();
  await prisma.$connect();
  return { prisma };
}

export async function truncateAuthTables(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE "audit_log", "user_role", "role_permission", "user", "role", "permission" RESTART IDENTITY CASCADE;`,
  );
}
