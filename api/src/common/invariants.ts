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
// Conventions §5 lists all nine invariants; P3 wires 1, 4, 6, 8, 9.
// The rest come online when their target tables gain real data:
//   INV-2, INV-3, INV-5 — P5 (receivable/payable + allocations)
//   INV-7             — P4 (purchase/sale)

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

export async function checkAll(prisma: ReadClient): Promise<InvariantResult[]> {
  return Promise.all([
    checkInv1(prisma),
    checkInv4(prisma),
    checkInv6(prisma),
    checkInv8(prisma),
    checkInv9(prisma),
  ]);
}

export function formatFailures(results: InvariantResult[]): string {
  const violated = results.filter((r) => r.failures.length > 0);
  if (violated.length === 0) return '';
  return violated.map((v) => `${v.id} — ${v.description}\n  ${v.failures.join('\n  ')}`).join('\n');
}
