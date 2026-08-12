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
import { mustGet } from '../common/must-get.js';
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
      const first = rows[0];
      if (!first) throw new LedgerContractError('balance row disappeared after upsert');
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
      delta.set(m.currencyId, mustGet(delta, m.currencyId, 'delta').plus(signed));
    }

    const overrideAppliedTo: string[] = [];
    for (const cid of distinctCurrencyIds) {
      const before = mustGet(balanceBefore, cid, 'balanceBefore');
      const cidDelta = mustGet(delta, cid, 'delta');
      const after = before.plus(cidDelta);
      if (after.gte(0)) continue;

      const isBase = cid === baseCurrencyId;
      const override = options.negativeBalanceOverride;
      const currency = mustGet(currencyById, cid, 'currency');

      if (!isBase) {
        // Non-base → refused entirely. D-015.
        if (override) {
          throw new NegativeBalanceOverrideDeniedError('non_base_currency', {
            currencyId: cid,
            currencyCode: currency.code,
          });
        }
        throw new InsufficientBalanceError({
          currencyId: cid,
          currencyCode: currency.code,
          available: before.toFixed(currency.decimalPlaces),
          requested: cidDelta.neg().toFixed(currency.decimalPlaces),
        });
      }

      // Base currency (MRU) — override permitted with the right shape.
      if (!override) {
        throw new InsufficientBalanceError({
          currencyId: cid,
          currencyCode: currency.code,
          available: before.toFixed(currency.decimalPlaces),
          requested: cidDelta.neg().toFixed(currency.decimalPlaces),
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
    // assigned id and sequence. So we insert one at a time through the
    // typed API. Reads happen inside the same tx so we still see the
    // just-written rows.
    //
    // Capture the (ledger row) → (originating Movement) mapping now,
    // before the sort below reorders the array — CostEngine needs the
    // originating movement to source unitCostMru / disposalValueMru.
    const inserted: LedgerEntry[] = [];
    const originatingByLedgerId = new Map<string, Movement>();
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
      originatingByLedgerId.set(created.id.toString(), m);
    }

    // Sort by sequence ascending — CostEngine (D-008) reads by sequence,
    // and while insertion order matches sequence order in practice
    // (global nextval, single writer inside one tx), the sort is cheap
    // insurance against Prisma reordering.
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
      const after = mustGet(balanceBefore, cid, 'balanceBefore').plus(mustGet(delta, cid, 'delta'));
      await tx.currencyBalance.update({
        where: { currencyId: cid },
        data: { cachedAmount: new Prisma.Decimal(after.toString()) },
      });
    }

    // ---- 6. Hand rows to CostEngine in sequence order --------------------
    // Match originating movement via the id-keyed map captured at insert
    // time — matching by (currencyId, direction, sourceType) collapses
    // when a batch has two movements sharing all three, which is rare
    // today but conceivable for future compound operations.
    for (const entry of inserted) {
      const originating = originatingByLedgerId.get(entry.id.toString());
      if (!originating) {
        throw new LedgerContractError('missing originating movement for ledger row', {
          ledgerEntryId: entry.id.toString(),
        });
      }
      await this.costs.apply(tx, entry, {
        baseCurrencyId,
        unitCostMru: originating.unitCostMru,
        disposalValueMru: originating.disposalValueMru,
      });
    }

    // ---- 7. Audit override use ------------------------------------------
    if (overrideAppliedTo.length > 0) {
      // Only reachable when override.reason was validated non-empty above.
      const override = options.negativeBalanceOverride;
      const firstMovement = movements[0];
      if (!override || !firstMovement) {
        throw new LedgerContractError('override audit reached without prerequisites');
      }
      for (const cid of overrideAppliedTo) {
        const before = mustGet(balanceBefore, cid, 'balanceBefore');
        const cidDelta = mustGet(delta, cid, 'delta');
        await this.audit.log(tx, {
          action: 'balance_override_applied',
          actorUserId: options.actorUserId ?? firstMovement.createdByUserId,
          entityType: 'currency_balance',
          entityId: cid,
          reason: override.reason,
          before: { cached_amount: before.toString() },
          after: { cached_amount: before.plus(cidDelta).toString() },
          ip: options.ip ?? null,
        });
      }
    }

    return inserted;
  }

  /**
   * Reversal helper (P6). Deactivates every ledger entry + cost movement
   * that came from a single business source, rolls the balance cache
   * back by the net delta of those entries, then asks CostEngine.replay
   * to rebuild the WAC book for every currency the source touched.
   *
   * Kept inside LedgerService so the chokepoint grep (§3.3) stays
   * clean — reversal must not write to ledger / balance / cost tables
   * from outside this file. The reversal services (PaymentReversalService,
   * ExpenseReversalService, TradeReversalService) call this once per
   * source they undo.
   *
   * Idempotent: a second call is a no-op because is_active=true is the
   * WHERE-clause guard for both statements. Returns the currency IDs
   * touched so callers can decide whether downstream restatement is
   * needed (trade reversal cares; payment / expense reversal doesn't).
   */
  async deactivateBySource(
    tx: Tx,
    sourceType: string,
    sourceId: string,
  ): Promise<{ affectedCurrencyIds: string[] }> {
    const entries = await tx.currencyLedger.findMany({
      where: { sourceType, sourceId, isActive: true },
    });
    if (entries.length === 0) {
      return { affectedCurrencyIds: [] };
    }

    const entryIds = entries.map((e) => e.id);
    const costMovements = await tx.costMovement.findMany({
      where: { ledgerEntryId: { in: entryIds }, isActive: true },
      select: { id: true, currencyId: true },
    });

    // Flip is_active=false — metadata-only on both tables, no amounts change.
    await tx.currencyLedger.updateMany({
      where: { id: { in: entryIds } },
      data: { isActive: false },
    });
    if (costMovements.length > 0) {
      await tx.costMovement.updateMany({
        where: { id: { in: costMovements.map((m) => m.id) } },
        data: { isActive: false },
      });
    }

    // Roll balance cache back by the net delta (sum in the *opposite*
    // direction). INV-1 is the safety net if this drifts.
    const deltaByCurrency = new Map<string, Decimal>();
    for (const e of entries) {
      const amount = new Decimal(e.amount.toString());
      const signed = e.direction === 'CREDIT' ? amount : amount.neg();
      deltaByCurrency.set(
        e.currencyId,
        (deltaByCurrency.get(e.currencyId) ?? new Decimal(0)).plus(signed),
      );
    }
    // Sort by currencyId ascending so this write ordering matches apply()'s
    // lock ordering — reduces cross-op contention with concurrent trades.
    const currencyIds = Array.from(deltaByCurrency.keys()).sort();
    for (const cid of currencyIds) {
      const delta = mustGet(deltaByCurrency, cid, 'delta');
      // Direct update on currency_balance is permitted here because we
      // are inside LedgerService — the chokepoint. The compensating
      // change is by construction the exact inverse of what apply()
      // originally wrote for these entries.
      await tx.currencyBalance.update({
        where: { currencyId: cid },
        data: { cachedAmount: { decrement: new Prisma.Decimal(delta.toString()) } },
      });
    }

    // Replay the cost engine forward for every non-base currency that
    // had a cost movement — WAC recomputes from active rows only, which
    // is exactly the post-deactivation state. Idempotent (D-021).
    const affectedCurrencyIds = Array.from(new Set(costMovements.map((m) => m.currencyId)));
    for (const cid of affectedCurrencyIds) {
      await this.costs.replay(tx, cid);
    }

    return { affectedCurrencyIds };
  }
}
