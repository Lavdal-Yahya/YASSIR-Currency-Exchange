#!/usr/bin/env tsx
// P3-12 · Runs the standing invariants against any Postgres database.
// Not tied to Nest — just a PrismaClient + the pure functions in
// src/common/invariants.ts. Meant to run on production via cron, and
// from an operator's shell against a restored backup as part of the
// P8-07 restore-rehearsal DoD.
//
// Usage:
//   npx tsx api/scripts/check-invariants.ts --database-url=postgresql://...
//   npx tsx api/scripts/check-invariants.ts            # uses $DATABASE_URL
//
// Exit codes:
//   0 — every invariant holds. Prints "OK".
//   1 — one or more invariants violated. Prints the failure list; each
//       line starts with the invariant ID so grep/awk pipelines work.
//   2 — usage / config error (missing DATABASE_URL, unreachable DB).

import { PrismaClient } from '@prisma/client';
import { checkAll, formatFailures } from '../src/common/invariants.js';

function parseArgs(argv: string[]): { databaseUrl: string | undefined } {
  let url = process.env.DATABASE_URL;
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--database-url=')) url = arg.slice('--database-url='.length);
    else if (arg === '--help' || arg === '-h') {
      // eslint-disable-next-line no-console
      console.log(
        'Usage: check-invariants.ts [--database-url=<postgres url>]\n' +
          'Falls back to $DATABASE_URL when the flag is absent.',
      );
      process.exit(0);
    }
  }
  return { databaseUrl: url };
}

async function main(): Promise<number> {
  const { databaseUrl } = parseArgs(process.argv);
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set and --database-url was not provided.');
    return 2;
  }
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    const results = await checkAll(prisma);
    const failed = results.filter((r) => r.failures.length > 0);
    if (failed.length === 0) {
      console.log('OK');
      return 0;
    }
    console.error(formatFailures(results));
    return 1;
  } catch (err) {
    console.error(`check-invariants: ${(err as Error).message}`);
    return 2;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then(process.exit)
  .catch((err) => {
    console.error(err);
    process.exit(2);
  });
