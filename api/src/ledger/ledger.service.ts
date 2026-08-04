import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from '../common/money.js';
import { AuditService } from '../audit/audit.service.js';
import {
  InactiveCurrencyError,
  InsufficientBalanceError,
  LedgerContractError,
  LedgerReferenceError,
  NegativeBalanceOverrideDeniedError,
  PaymentMethodNoteRequiredError,
} from '../common/errors/ledger.errors.js';
import { CostEngine } from './cost.engine.js';
import type { ApplyOptions, LedgerEntry, Movement, Tx } from './ledger.types.js';

// LedgerService — the single code path that changes a currency balance.
// See architecture §3.3 and D-004. Numbered contract mirrors the phase
// document.
//
// One method, apply(). It:
//   1. requires the transaction client — no non-tx overload exists;
//   2. sorts distinct currencyIds ascending and acquires
//      SELECT ... FOR UPDATE on each currency_balance row in that
//      order, one statement per currency (Postgres does not guarantee
//      lock-acquisition order from a batched IN clause);
//   3. pre-computes the resulting balances and refuses insufficient
//      cases with structured error data (not a constraint violation);
//   4. persists ledger rows in batch, updates the balance cache,
//      hands each row to CostEngine in ledger-sequence order;
//   5. returns the inserted ledger rows so business services can
//      persist their IDs (e.g. purchase.ledger_entry_ids for reversal).
//
// Base-leg rule (D-019) is NOT here — it belongs above the ledger in the
// trade services (P4). LedgerService stays a general primitive so
// expenses, settlements, and opening balances can use it unchanged.

@Injectable()
export class LedgerService {
  constructor(
    private readonly costs: CostEngine,
    private readonly audit: AuditService,
  ) {}

  async apply(tx: Tx, movements: Movement[], options: ApplyOptions = {}): Promise<LedgerEntry[]> {
    if (movements.length === 0) {
      throw new LedgerContractError('apply() called with empty movements array');
    }

    // ---- 1. Load context --------------------------------------------------
    const settings = await tx.settings.findUnique({ where: { id: 1 } });
    if (!settings) {
      throw new LedgerContractError('settings row missing — ledger writes refused');
    }
    const baseCurrencyId = settings.baseCurrencyId;

    const distinctCurrencyIds = Array.from(new Set(movements.map((m) => m.currencyId))).sort();
    const currencyRows = await tx.currency.findMany({
      where: { id: { in: distinctCurrencyIds } },
    });
    const currencyById = new Map(currencyRows.map((c) => [c.id, c]));

    for (const cid of distinctCurrencyIds) {
      const row = currencyById.get(cid);
      if (!row) throw new LedgerReferenceError('currency', cid);
      if (!row.isActive) throw new InactiveCurrencyError(row.code);
    }

    // Payment methods — needed to enforce requires_note (D-020).
    const methodIds = Array.from(
      new Set(
        movements.map((m) => m.paymentMethodId).filter((x): x is string => typeof x === 'string'),
      ),
    );
    const methodById = new Map(
      methodIds.length === 0
        ? []
        : (await tx.paymentMethod.findMany({ where: { id: { in: methodIds } } })).map((m) => [
            m.id,
            m,
          ]),
    );
    for (const m of movements) {
      if (!m.paymentMethodId) continue;
      const pm = methodById.get(m.paymentMethodId);
      if (!pm) throw new LedgerReferenceError('payment_method', m.paymentMethodId);
      if (pm.requiresNote && (m.note ?? '').trim() === '') {
        throw new PaymentMethodNoteRequiredError({ paymentMethodCode: pm.code });
      }
    }

    // ---- 2. Lock balance rows in sorted order ----------------------------
    // Ensure a row exists (upsert), then FOR UPDATE it. Postgres does not
    // guarantee lock ordering across a batched IN clause, so we issue one
    // pair of statements per currency, in ascending id order. This is
    // exactly what prevents two concurrent trades locking two currencies
    // in opposite orders and deadlocking.
    const balanceBefore = new Map<string, Decimal>();
    for (const cid of distinctCurrencyIds) {
      await tx.$executeRaw`
        INSERT INTO "currency_balance" ("currency_id", "cached_amount", "updated_at")
        VALUES (${cid}::uuid, 0, now())
        ON CONFLICT ("currency_id") DO NOTHING
      `;
      const rows = await tx.$queryRaw<{ cached_amount: Prisma.Decimal }[]>`
        SELECT "cached_amount"
        FROM "currency_balance"
        WHERE "currency_id" = ${cid}::uuid
        FOR UPDATE
      `;
      if (rows.length === 0) {
        // Impossible after the upsert above unless someone deleted the row
        // between the two statements — that person would first have to
        // bypass REVOKE DELETE, so this is genuinely unreachable.
        throw new LedgerContractError('balance row disappeared during locking', {
          currencyId: cid,
        });
      }
      const first = rows[0]!;
      balanceBefore.set(cid, new Decimal(first.cached_amount.toString()));
    }

    // ---- 3. Compute deltas + validate sufficiency ------------------------
    const delta = new Map<string, Decimal>();
    for (const cid of distinctCurrencyIds) delta.set(cid, new Decimal(0));

    for (const m of movements) {
      const amount = m.amount instanceof Decimal ? m.amount : new Decimal(m.amount);
      if (amount.lte(0)) {
        throw new LedgerContractError('movement amount must be > 0 (direction carries sign)', {
          currencyId: m.currencyId,
          amount: amount.toString(),
        });
      }
      const signed = m.direction === 'CREDIT' ? amount : amount.neg();
      delta.set(m.currencyId, delta.get(m.currencyId)!.plus(signed));
    }

    const overrideAppliedTo: string[] = [];
    for (const cid of distinctCurrencyIds) {
      const before = balanceBefore.get(cid)!;
      const after = before.plus(delta.get(cid)!);
      if (after.gte(0)) continue;

      const isBase = cid === baseCurrencyId;
      const override = options.negativeBalanceOverride;

      if (!isBase) {
        // Non-base → refused entirely. D-015.
        if (override) {
          throw new NegativeBalanceOverrideDeniedError('non_base_currency', {
            currencyId: cid,
            currencyCode: currencyById.get(cid)!.code,
          });
        }
        throw new InsufficientBalanceError({
          currencyId: cid,
          currencyCode: currencyById.get(cid)!.code,
          available: before.toFixed(currencyById.get(cid)!.decimalPlaces),
          requested: delta.get(cid)!.neg().toFixed(currencyById.get(cid)!.decimalPlaces),
        });
      }

      // Base currency (MRU) — override permitted with the right shape.
      if (!override) {
        throw new InsufficientBalanceError({
          currencyId: cid,
          currencyCode: currencyById.get(cid)!.code,
          available: before.toFixed(currencyById.get(cid)!.decimalPlaces),
          requested: delta.get(cid)!.neg().toFixed(currencyById.get(cid)!.decimalPlaces),
        });
      }
      if (!override.actorHasPermission) {
        throw new NegativeBalanceOverrideDeniedError('not_owner', { currencyId: cid });
      }
      if (override.reason.trim() === '') {
        throw new NegativeBalanceOverrideDeniedError('reason_required', { currencyId: cid });
      }
      overrideAppliedTo.push(cid);
    }

    // ---- 4. Insert ledger rows in batch ---------------------------------
    // Prisma's createMany returns count only — we need the rows with their
    // assigned id and sequence. So we issue one INSERT ... RETURNING via
    // raw SQL, then read them back through Prisma's typed API for the
    // caller-facing shape. Reads happen inside the same tx so we still
    // see the just-written rows.
    const inserted: LedgerEntry[] = [];
    for (const m of movements) {
      const amount = m.amount instanceof Decimal ? m.amount : new Decimal(m.amount);
      const created = await tx.currencyLedger.create({
        data: {
          currencyId: m.currencyId,
          direction: m.direction,
          amount: new Prisma.Decimal(amount.toString()),
          sourceType: m.sourceType,
          sourceId: m.sourceId ?? null,
          paymentMethodId: m.paymentMethodId ?? null,
          note: m.note ?? null,
          transactionDate: m.transactionDate,
          description: m.description,
          createdByUserId: m.createdByUserId,
        },
      });
      inserted.push(created);
    }

    // Sort by sequence ascending — the write order of a batch may differ
    // from insertion order if Prisma reorders, and CostEngine.replay reads
    // by sequence. Insert-time order matches sequence order in practice
    // (sequence is a global nextval), but the sort is cheap insurance.
    inserted.sort((a, b) => {
      const s = a.sequence - b.sequence;
      return s === 0n ? 0 : s > 0n ? 1 : -1;
    });

    // ---- 5. Update cached balances --------------------------------------
    // One UPDATE per currency. The trigger on currency_balance
    // (check_non_base_balance_nonneg) is our independent last line of
    // defence — if the pre-write validation above is wrong, the trigger
    // refuses the write with a constraint violation the tests will catch.
    for (const cid of distinctCurrencyIds) {
      const after = balanceBefore.get(cid)!.plus(delta.get(cid)!);
      await tx.currencyBalance.update({
        where: { currencyId: cid },
        data: { cachedAmount: new Prisma.Decimal(after.toString()) },
      });
    }

    // ---- 6. Hand rows to CostEngine in sequence order --------------------
    for (const entry of inserted) {
      const originating = movements.find(
        (m) =>
          m.currencyId === entry.currencyId &&
          m.direction === entry.direction &&
          m.sourceType === entry.sourceType,
      );
      await this.costs.apply(tx, entry, {
        baseCurrencyId,
        unitCostMru: originating?.unitCostMru,
      });
    }

    // ---- 7. Audit override use ------------------------------------------
    if (overrideAppliedTo.length > 0) {
      const override = options.negativeBalanceOverride!;
      for (const cid of overrideAppliedTo) {
        await this.audit.log(tx, {
          action: 'balance_override_applied',
          actorUserId: options.actorUserId ?? movements[0]!.createdByUserId,
          entityType: 'currency_balance',
          entityId: cid,
          reason: override.reason,
          before: { cached_amount: balanceBefore.get(cid)!.toString() },
          after: { cached_amount: balanceBefore.get(cid)!.plus(delta.get(cid)!).toString() },
          ip: options.ip ?? null,
        });
      }
    }

    return inserted;
  }
}
