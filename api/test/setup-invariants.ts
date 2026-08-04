// Wires the standing invariants into the integration suite's global
// afterEach. Every test in test/integration/**/*.test.ts, without
// opting in, verifies INV-1/4/6/8/9 after it completes — the fastest
// way to catch a ledger regression is to already be running the check.
//
// Uses its own PrismaClient so it does not disturb tests that manage
// their own connections. The invariants are read-only, so a second
// connection is safe (no locks, no long-running transactions).
//
// The check is skipped when there is no `settings` row — that state
// is the pre-P2-02 shape used by the auth-only tests, and the
// invariants have nothing to compare against.

import { afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { checkAll, formatFailures } from '../src/common/invariants.js';

const prisma = new PrismaClient();

afterEach(async () => {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!settings) return; // auth-only or pre-settings-seed test — nothing to invariant-check
  const results = await checkAll(prisma);
  const message = formatFailures(results);
  if (message) {
    throw new Error(`Standing invariants violated after test:\n${message}`);
  }
});
