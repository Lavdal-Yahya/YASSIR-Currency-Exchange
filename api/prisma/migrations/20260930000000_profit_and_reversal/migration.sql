-- P6-01 · reversal columns on purchase / sale / payment / expense.
--
-- Every reversal target gains three columns:
--   * reversal_reason        — mandatory free-text on any REVERSED row.
--   * reversed_by_user_id    — actor who reversed. Preserved even if user
--                              is later deactivated (ON DELETE SET NULL).
--   * reversed_at            — timestamp of the reversal action.
--
-- Ledger tables (currency_ledger / cost_movement) are untouched — is_active
-- already exists from P3-01. Reversal flips it; nothing else.
--
-- CHECK per table:
--   * When status = 'REVERSED', reversal_reason must be non-empty AND
--     reversed_at must be non-null. Enforced belt-and-braces at the DB
--     even though the service layer already validates.
--
-- No new indexes: audit-log queries drive the audit viewer, not these
-- columns. Filtering active rows via the existing status enum is already
-- indexed on the trade tables.

ALTER TABLE "purchase"
  ADD COLUMN "reversal_reason" TEXT,
  ADD COLUMN "reversed_by_user_id" UUID,
  ADD COLUMN "reversed_at" TIMESTAMPTZ(6);

ALTER TABLE "sale"
  ADD COLUMN "reversal_reason" TEXT,
  ADD COLUMN "reversed_by_user_id" UUID,
  ADD COLUMN "reversed_at" TIMESTAMPTZ(6);

ALTER TABLE "payment"
  ADD COLUMN "reversal_reason" TEXT,
  ADD COLUMN "reversed_by_user_id" UUID,
  ADD COLUMN "reversed_at" TIMESTAMPTZ(6);

ALTER TABLE "expense"
  ADD COLUMN "reversal_reason" TEXT,
  ADD COLUMN "reversed_by_user_id" UUID,
  ADD COLUMN "reversed_at" TIMESTAMPTZ(6);

-- FKs to user, nullable, SET NULL on user delete (users are archived not
-- deleted in practice, but ledger integrity mustn't depend on that).
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_reversed_by_user_id_fkey"
  FOREIGN KEY ("reversed_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sale" ADD CONSTRAINT "sale_reversed_by_user_id_fkey"
  FOREIGN KEY ("reversed_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payment" ADD CONSTRAINT "payment_reversed_by_user_id_fkey"
  FOREIGN KEY ("reversed_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "expense" ADD CONSTRAINT "expense_reversed_by_user_id_fkey"
  FOREIGN KEY ("reversed_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-added CHECK constraints: REVERSED status requires reason + timestamp.
-- ---------------------------------------------------------------------------

ALTER TABLE "purchase"
  ADD CONSTRAINT "purchase_reversal_consistency_check"
  CHECK (
    ("status" = 'REVERSED' AND "reversal_reason" IS NOT NULL AND btrim("reversal_reason") <> '' AND "reversed_at" IS NOT NULL)
    OR
    ("status" <> 'REVERSED')
  );

ALTER TABLE "sale"
  ADD CONSTRAINT "sale_reversal_consistency_check"
  CHECK (
    ("status" = 'REVERSED' AND "reversal_reason" IS NOT NULL AND btrim("reversal_reason") <> '' AND "reversed_at" IS NOT NULL)
    OR
    ("status" <> 'REVERSED')
  );

ALTER TABLE "payment"
  ADD CONSTRAINT "payment_reversal_consistency_check"
  CHECK (
    ("status" = 'REVERSED' AND "reversal_reason" IS NOT NULL AND btrim("reversal_reason") <> '' AND "reversed_at" IS NOT NULL)
    OR
    ("status" <> 'REVERSED')
  );

ALTER TABLE "expense"
  ADD CONSTRAINT "expense_reversal_consistency_check"
  CHECK (
    ("status" = 'REVERSED' AND "reversal_reason" IS NOT NULL AND btrim("reversal_reason") <> '' AND "reversed_at" IS NOT NULL)
    OR
    ("status" <> 'REVERSED')
  );
