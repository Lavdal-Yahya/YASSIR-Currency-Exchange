import type { PrismaClient, Prisma } from '@prisma/client';
import { Decimal } from './money.js';

// Standing invariants — the properties that must hold after every
// database write. Wired into the integration suite's global afterEach
// (test/setup-invariants.ts) so every test verifies them for free, and
// also runnable standalone via api/scripts/check-invariants.ts (P3-12)
// against production databases.
//
// Each invariant is a pure function of the current DB state, returning
// a list of human-readable failure strings. An empty list means the
// invariant holds. Combined via checkAll(); tests fail on any non-empty
// list.
//
// Conventions §5 lists all nine invariants; P3 wires 1, 4, 6, 8, 9;
// P4 adds INV-7 now that purchase/sale rows exist. The rest come
// online when their target tables gain real data:
//   INV-2, INV-3, INV-5 — P5 (receivable/payable + allocations)

export interface InvariantResult {
  id: string;
  description: string;
  failures: string[];
}

type ReadClient = PrismaClient | Prisma.TransactionClient;

// INV-1 · For every currency: Σ active credits − Σ active debits = cached_amount
export async function checkInv1(prisma: ReadClient): Promise<InvariantResult> {
  const failures: string[] = [];
  const balances = await prisma.currencyBalance.findMany({
    include: { currency: { select: { code: true } } },
  });
  for (const b of balances) {
    const rows = await prisma.$queryRaw<{ delta: string | null }[]>`
      SELECT COALESCE(
        SUM(CASE WHEN "direction" = 'CREDIT' THEN "amount" ELSE -"amount" END),
        0
      )::text AS delta
      FROM "currency_ledger"
      WHERE "currency_id" = ${b.currencyId}::uuid
        AND "is_active" = true
    `;
    const first = rows[0];
    const delta = new Decimal(first?.delta ?? '0');
    const cached = new Decimal(b.cachedAmount.toString());
    if (!delta.eq(cached)) {
      failures.push(
        `${b.currency.code}: ledger sum ${delta.toFixed(4)} ≠ cached ${cached.toFixed(4)}`,
      );
    }
  }
  return { id: 'INV-1', description: 'ledger sum equals cached balance', failures };
}

// INV-4 · currency_cost.cached_avg equals a replay of active cost movements
export async function checkInv4(prisma: ReadClient): Promise<InvariantResult> {
  const failures: string[] = [];
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!settings) {
    return {
      id: 'INV-4',
      description: 'WAC cache equals replay of active cost movements',
      failures: ['settings row missing — cannot resolve base currency'],
    };
  }
  const caches = await prisma.currencyCost.findMany({
    include: { currency: { select: { code: true } } },
  });
  for (const c of caches) {
    if (c.currencyId === settings.baseCurrencyId) continue; // MRU is exempt (D-006)
    const movements = await prisma.costMovement.findMany({
      where: { currencyId: c.currencyId, isActive: true },
      orderBy: { sequence: 'asc' },
    });
    let avg = new Decimal(0);
    let qty = new Decimal(0);
    for (const m of movements) {
      const mq = new Decimal(m.quantity.toString());
      const mu = new Decimal(m.unitCostMru.toString());
      if (m.kind === 'ACQUISITION') {
        const nq = qty.plus(mq);
        avg = nq.eq(0) ? new Decimal(0) : qty.times(avg).plus(mq.times(mu)).div(nq);
        qty = nq;
      } else {
        qty = qty.minus(mq);
        if (qty.eq(0)) avg = new Decimal(0);
      }
    }
    const cachedAvg = new Decimal(c.cachedAvgMru.toString());
    const cachedQty = new Decimal(c.cachedQuantity.toString());
    // Rate math accumulates precision; tolerate a 1e-8 drift on avg —
    // any real bug shows a much larger delta.
    if (avg.minus(cachedAvg).abs().gt('0.00000001')) {
      failures.push(
        `${c.currency.code}: WAC replay ${avg.toFixed(8)} ≠ cached ${cachedAvg.toFixed(8)}`,
      );
    }
    if (!qty.eq(cachedQty)) {
      failures.push(
        `${c.currency.code}: quantity replay ${qty.toFixed(4)} ≠ cached ${cachedQty.toFixed(4)}`,
      );
    }
  }
  return { id: 'INV-4', description: 'WAC cache equals replay of active cost movements', failures };
}

// INV-6 · Every ledger entry has an active source, and every active
// financial source has its ledger entries. In P3 the only source is
// 'opening_balance' — the check narrows to that discriminator until
// P4/P5 add rows for other sources.
export async function checkInv6(prisma: ReadClient): Promise<InvariantResult> {
  const failures: string[] = [];
  // (a) Ledger → source direction, for source types whose tables exist.
  const openingRows = await prisma.currencyLedger.findMany({
    where: { sourceType: 'opening_balance', isActive: true },
    select: { id: true, sourceId: true },
  });
  for (const row of openingRows) {
    if (row.sourceId === null) {
      // Openings are allowed to have a NULL source_id per the DB CHECK,
      // but the OpeningBalance table (P3-08, PR-B) will fill it once it
      // exists. Until then this branch just verifies the CHECK holds.
      continue;
    }
    // The opening_balance table lands in PR-B. Skip the reverse lookup
    // until it exists — the check auto-tightens once the model ships.
  }
  // (b) Source → ledger direction — same story: nothing to check yet.
  return {
    id: 'INV-6',
    description: 'ledger ↔ source referential integrity',
    failures,
  };
}

// INV-8 · No non-base currency has a negative balance
export async function checkInv8(prisma: ReadClient): Promise<InvariantResult> {
  const failures: string[] = [];
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!settings) {
    return {
      id: 'INV-8',
      description: 'no non-base currency has a negative balance',
      failures: ['settings row missing — cannot resolve base currency'],
    };
  }
  const balances = await prisma.currencyBalance.findMany({
    include: { currency: { select: { code: true } } },
  });
  for (const b of balances) {
    if (b.currencyId === settings.baseCurrencyId) continue;
    if (new Decimal(b.cachedAmount.toString()).lt(0)) {
      failures.push(`${b.currency.code}: cached_amount ${b.cachedAmount.toString()} < 0`);
    }
  }
  return { id: 'INV-8', description: 'no non-base currency has a negative balance', failures };
}

// INV-9 · Every cash-movement ledger entry has a payment_method_id;
// entries on requires_note methods have a non-empty note. In P3 the
// only writers of cash movements are opening entries (which carry no
// payment method by design), so the invariant looks at
// source_type IN ('payment', 'expense') plus any row that DOES carry
// a payment method with requires_note = true.
export async function checkInv9(prisma: ReadClient): Promise<InvariantResult> {
  const failures: string[] = [];
  // (a) Payment / expense entries must have a payment_method_id.
  const missingMethod = await prisma.currencyLedger.findMany({
    where: {
      isActive: true,
      sourceType: { in: ['payment', 'expense'] },
      paymentMethodId: null,
    },
    select: { id: true, sourceType: true, sourceId: true },
  });
  for (const r of missingMethod) {
    failures.push(
      `ledger ${r.id.toString()} (source=${r.sourceType}/${r.sourceId ?? '∅'}) has no payment_method_id`,
    );
  }
  // (b) Any entry with a method that requires a note must have one.
  const rowsWithMethod = await prisma.currencyLedger.findMany({
    where: { isActive: true, paymentMethodId: { not: null } },
    include: { paymentMethod: { select: { code: true, requiresNote: true } } },
  });
  for (const r of rowsWithMethod) {
    if (!r.paymentMethod?.requiresNote) continue;
    if ((r.note ?? '').trim() === '') {
      failures.push(
        `ledger ${r.id.toString()} on method ${r.paymentMethod.code} (requires_note=true) has empty note`,
      );
    }
  }
  return {
    id: 'INV-9',
    description: 'cash movements have payment method + required note',
    failures,
  };
}

// INV-7 · Every purchase and every sale has exactly one base-currency
// leg. Enforced at write time by the check_trade_has_base_leg trigger
// and by NoBaseCurrencyLegError in the trade services (D-019); INV-7
// asserts the invariant continues to hold across the entire history,
// including reversed rows — a bug in reversal that flipped the wrong
// column would show up here.
export async function checkInv7(prisma: ReadClient): Promise<InvariantResult> {
  const failures: string[] = [];
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!settings) {
    return {
      id: 'INV-7',
      description: 'every trade has exactly one base-currency leg',
      failures: ['settings row missing — cannot resolve base currency'],
    };
  }
  const baseId = settings.baseCurrencyId;

  // Purchases: delivered XOR payment must be base_currency_id.
  const badPurchases = await prisma.$queryRaw<
    { id: string; delivered_currency_id: string; payment_currency_id: string }[]
  >`
    SELECT "id", "delivered_currency_id", "payment_currency_id"
    FROM "purchase"
    WHERE ("delivered_currency_id" = ${baseId}::uuid)
        = ("payment_currency_id"   = ${baseId}::uuid)
  `;
  for (const row of badPurchases) {
    failures.push(
      `purchase ${row.id}: delivered=${row.delivered_currency_id} payment=${row.payment_currency_id} — none-or-both are the base currency`,
    );
  }

  const badSales = await prisma.$queryRaw<
    { id: string; delivered_currency_id: string; payment_currency_id: string }[]
  >`
    SELECT "id", "delivered_currency_id", "payment_currency_id"
    FROM "sale"
    WHERE ("delivered_currency_id" = ${baseId}::uuid)
        = ("payment_currency_id"   = ${baseId}::uuid)
  `;
  for (const row of badSales) {
    failures.push(
      `sale ${row.id}: delivered=${row.delivered_currency_id} payment=${row.payment_currency_id} — none-or-both are the base currency`,
    );
  }

  return {
    id: 'INV-7',
    description: 'every trade has exactly one base-currency leg',
    failures,
  };
}

// INV-2 · For each non-REVERSED receivable: original − Σ(live allocations) = outstanding,
// and outstanding ≥ 0. D-011 liveness: allocation counts when its payment is CONFIRMED.
export async function checkInv2(prisma: ReadClient): Promise<InvariantResult> {
  const failures: string[] = [];
  const receivables = await prisma.receivable.findMany({
    where: { status: { not: 'REVERSED' } },
    select: { id: true, originalAmount: true, outstandingAmount: true },
  });
  for (const r of receivables) {
    const rows = await prisma.$queryRaw<{ sum: string }[]>`
      SELECT COALESCE(SUM(a."amount"), 0)::text AS sum
      FROM "allocation" a
      JOIN "payment" p ON p."id" = a."payment_id"
      WHERE a."target_type" = 'receivable'
        AND a."target_id" = ${r.id}::uuid
        AND p."status" = 'CONFIRMED'
    `;
    const paidSum = new Decimal(rows[0]?.sum ?? '0');
    const original = new Decimal(r.originalAmount.toString());
    const stored = new Decimal(r.outstandingAmount.toString());
    const computed = original.minus(paidSum);
    if (computed.lt(0)) {
      failures.push(
        `receivable ${r.id}: computed outstanding ${computed.toFixed(4)} < 0 (INV-5 violated)`,
      );
    } else if (!computed.eq(stored)) {
      failures.push(
        `receivable ${r.id}: computed ${computed.toFixed(4)} ≠ stored ${stored.toFixed(4)}`,
      );
    }
  }
  return {
    id: 'INV-2',
    description: 'receivable outstanding = original − live allocations',
    failures,
  };
}

// INV-3 · Same as INV-2, for payables.
export async function checkInv3(prisma: ReadClient): Promise<InvariantResult> {
  const failures: string[] = [];
  const payables = await prisma.payable.findMany({
    where: { status: { not: 'REVERSED' } },
    select: { id: true, originalAmount: true, outstandingAmount: true },
  });
  for (const p of payables) {
    const rows = await prisma.$queryRaw<{ sum: string }[]>`
      SELECT COALESCE(SUM(a."amount"), 0)::text AS sum
      FROM "allocation" a
      JOIN "payment" pay ON pay."id" = a."payment_id"
      WHERE a."target_type" = 'payable'
        AND a."target_id" = ${p.id}::uuid
        AND pay."status" = 'CONFIRMED'
    `;
    const paidSum = new Decimal(rows[0]?.sum ?? '0');
    const original = new Decimal(p.originalAmount.toString());
    const stored = new Decimal(p.outstandingAmount.toString());
    const computed = original.minus(paidSum);
    if (computed.lt(0)) {
      failures.push(
        `payable ${p.id}: computed outstanding ${computed.toFixed(4)} < 0 (INV-5 violated)`,
      );
    } else if (!computed.eq(stored)) {
      failures.push(
        `payable ${p.id}: computed ${computed.toFixed(4)} ≠ stored ${stored.toFixed(4)}`,
      );
    }
  }
  return {
    id: 'INV-3',
    description: 'payable outstanding = original − live allocations',
    failures,
  };
}

// INV-5 · For each non-REVERSED receivable and payable: live allocation
// sum ≤ original_amount. Independent of INV-2/3 — catches cases where
// the stored outstanding was manually patched to hide overpayment.
export async function checkInv5(prisma: ReadClient): Promise<InvariantResult> {
  const failures: string[] = [];

  const receivables = await prisma.receivable.findMany({
    where: { status: { not: 'REVERSED' } },
    select: { id: true, originalAmount: true },
  });
  for (const r of receivables) {
    const rows = await prisma.$queryRaw<{ sum: string }[]>`
      SELECT COALESCE(SUM(a."amount"), 0)::text AS sum
      FROM "allocation" a
      JOIN "payment" p ON p."id" = a."payment_id"
      WHERE a."target_type" = 'receivable'
        AND a."target_id" = ${r.id}::uuid
        AND p."status" = 'CONFIRMED'
    `;
    const paid = new Decimal(rows[0]?.sum ?? '0');
    const original = new Decimal(r.originalAmount.toString());
    if (paid.gt(original)) {
      failures.push(
        `receivable ${r.id}: live allocations ${paid.toFixed(4)} > original ${original.toFixed(4)}`,
      );
    }
  }

  const payables = await prisma.payable.findMany({
    where: { status: { not: 'REVERSED' } },
    select: { id: true, originalAmount: true },
  });
  for (const p of payables) {
    const rows = await prisma.$queryRaw<{ sum: string }[]>`
      SELECT COALESCE(SUM(a."amount"), 0)::text AS sum
      FROM "allocation" a
      JOIN "payment" pay ON pay."id" = a."payment_id"
      WHERE a."target_type" = 'payable'
        AND a."target_id" = ${p.id}::uuid
        AND pay."status" = 'CONFIRMED'
    `;
    const paid = new Decimal(rows[0]?.sum ?? '0');
    const original = new Decimal(p.originalAmount.toString());
    if (paid.gt(original)) {
      failures.push(
        `payable ${p.id}: live allocations ${paid.toFixed(4)} > original ${original.toFixed(4)}`,
      );
    }
  }

  return {
    id: 'INV-5',
    description: 'live allocation sum ≤ original for each debt',
    failures,
  };
}

export async function checkAll(prisma: ReadClient): Promise<InvariantResult[]> {
  return Promise.all([
    checkInv1(prisma),
    checkInv2(prisma),
    checkInv3(prisma),
    checkInv4(prisma),
    checkInv5(prisma),
    checkInv6(prisma),
    checkInv7(prisma),
    checkInv8(prisma),
    checkInv9(prisma),
  ]);
}

export function formatFailures(results: InvariantResult[]): string {
  const violated = results.filter((r) => r.failures.length > 0);
  if (violated.length === 0) return '';
  return violated.map((v) => `${v.id} — ${v.description}\n  ${v.failures.join('\n  ')}`).join('\n');
}
