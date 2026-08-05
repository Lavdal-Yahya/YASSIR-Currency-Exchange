-- P4-01 · trades migration.
--
-- Two near-mirror tables (purchase, sale) plus their raw-SQL constraints,
-- triggers, and REVOKE DELETE grants. Every hand-added statement below
-- is pasted from docs/schema-review.md §7.7 (signed off 2026-08-04)
-- with two amendments from the decisions log:
--
--   * D-023 item 4 — rate/total strict equality, no per-currency
--     tolerance trigger. Enforced as a plain CHECK on both trade
--     tables. Companion decision D-024 documents the operator-facing
--     RateTotalMismatchError that catches the mismatch above the
--     ledger.
--
--   * D-023 item 5 — idempotency_key has no TTL. The column lives on
--     the trade table itself (schema review §4.1) with a
--     request-body-hash column so "same key, different body" can be
--     detected without keeping a separate cache table.
--
-- The receivable/payable skeletons landed in 20260804004653_add_openings
-- with the origin/source-shape CHECK already tolerating (`TRADE` +
-- non-null source). Nothing here modifies them — trade services fill
-- `source_type='purchase'|'sale'` + `source_id` when writing the row.

-- CreateEnum
CREATE TYPE "trade_status" AS ENUM ('CONFIRMED', 'CANCELLED', 'REVERSED');

-- CreateEnum
CREATE TYPE "trade_payment_status" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'PAID');

-- CreateTable
CREATE TABLE "purchase" (
    "id" UUID NOT NULL,
    "contact_id" UUID,
    "delivered_currency_id" UUID NOT NULL,
    "delivered_amount" DECIMAL(24,4) NOT NULL,
    "payment_currency_id" UUID NOT NULL,
    "payment_total" DECIMAL(24,4) NOT NULL,
    "rate" DECIMAL(24,8) NOT NULL,
    "immediate_payment" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "outstanding_amount" DECIMAL(24,4) NOT NULL,
    "status" "trade_status" NOT NULL DEFAULT 'CONFIRMED',
    "payment_status" "trade_payment_status" NOT NULL,
    "payment_method_id" UUID,
    "payment_method_note" TEXT,
    "reference" TEXT,
    "notes" TEXT,
    "transaction_date" TIMESTAMPTZ(6) NOT NULL,
    "idempotency_key" TEXT,
    "idempotency_body_hash" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale" (
    "id" UUID NOT NULL,
    "contact_id" UUID,
    "delivered_currency_id" UUID NOT NULL,
    "delivered_amount" DECIMAL(24,4) NOT NULL,
    "payment_currency_id" UUID NOT NULL,
    "payment_total" DECIMAL(24,4) NOT NULL,
    "rate" DECIMAL(24,8) NOT NULL,
    "immediate_payment" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "outstanding_amount" DECIMAL(24,4) NOT NULL,
    "status" "trade_status" NOT NULL DEFAULT 'CONFIRMED',
    "payment_status" "trade_payment_status" NOT NULL,
    "payment_method_id" UUID,
    "payment_method_note" TEXT,
    "reference" TEXT,
    "notes" TEXT,
    "transaction_date" TIMESTAMPTZ(6) NOT NULL,
    "idempotency_key" TEXT,
    "idempotency_body_hash" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "cost_of_currency_sold_mru" DECIMAL(24,4) NOT NULL,
    "gross_profit_mru" DECIMAL(24,4) NOT NULL,
    "recipient_name" TEXT,
    "destination" TEXT,

    CONSTRAINT "sale_pkey" PRIMARY KEY ("id")
);

-- CreateIndex — spec §24 filter set (both tables)
CREATE INDEX "purchase_transaction_status_idx" ON "purchase"("transaction_date" DESC, "status");
CREATE INDEX "purchase_contact_transaction_idx" ON "purchase"("contact_id", "transaction_date" DESC);
CREATE INDEX "sale_transaction_status_idx" ON "sale"("transaction_date" DESC, "status");
CREATE INDEX "sale_contact_transaction_idx" ON "sale"("contact_id", "transaction_date" DESC);

-- CreateIndex — idempotency (partial unique, key NULL for pre-P4 seeds)
CREATE UNIQUE INDEX "purchase_user_idempotency_key" ON "purchase"("created_by_user_id", "idempotency_key")
    WHERE "idempotency_key" IS NOT NULL;
CREATE UNIQUE INDEX "sale_user_idempotency_key" ON "sale"("created_by_user_id", "idempotency_key")
    WHERE "idempotency_key" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_delivered_currency_id_fkey" FOREIGN KEY ("delivered_currency_id") REFERENCES "currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_payment_currency_id_fkey" FOREIGN KEY ("payment_currency_id") REFERENCES "currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "payment_method"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sale" ADD CONSTRAINT "sale_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sale" ADD CONSTRAINT "sale_delivered_currency_id_fkey" FOREIGN KEY ("delivered_currency_id") REFERENCES "currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sale" ADD CONSTRAINT "sale_payment_currency_id_fkey" FOREIGN KEY ("payment_currency_id") REFERENCES "currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sale" ADD CONSTRAINT "sale_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "payment_method"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sale" ADD CONSTRAINT "sale_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-added below. Verbatim from docs/schema-review.md §7.7, amended by
-- D-023 item 4 (rate/total strict equality) + D-024.
-- Regenerating this migration silently drops everything below this line;
-- the self-review checklist (conventions §1 item 6) is the only defence.
-- ---------------------------------------------------------------------------

-- §7.7  purchase

-- Two currencies must differ.
ALTER TABLE "purchase"
  ADD CONSTRAINT "purchase_two_currencies_check"
  CHECK ("delivered_currency_id" <> "payment_currency_id");

-- Every monetary amount positive; immediate_payment may be zero (unpaid).
ALTER TABLE "purchase"
  ADD CONSTRAINT "purchase_amounts_positive_check"
  CHECK (
    "delivered_amount" > 0 AND
    "payment_total" > 0 AND
    "rate" > 0 AND
    "immediate_payment" >= 0
  );

-- Outstanding derives from payment_total - immediate_payment, exactly
-- (both in the same currency's minor unit already).
ALTER TABLE "purchase"
  ADD CONSTRAINT "purchase_outstanding_matches_check"
  CHECK ("outstanding_amount" = "payment_total" - "immediate_payment");

-- Immediate payment cannot exceed the total.
ALTER TABLE "purchase"
  ADD CONSTRAINT "purchase_immediate_le_total_check"
  CHECK ("immediate_payment" <= "payment_total");

-- Rate/total strict equality (D-023 item 4 + D-024). The service surfaces
-- a friendly 422 RateTotalMismatchError before this fires; the CHECK is
-- the last line of defence. No per-currency tolerance — the frontend is
-- the single API client and rounds one side to make the product exact.
ALTER TABLE "purchase"
  ADD CONSTRAINT "purchase_rate_total_exact_check"
  CHECK ("payment_total" = "delivered_amount" * "rate");

-- Method required when there is actual cash movement (immediate > 0).
ALTER TABLE "purchase"
  ADD CONSTRAINT "purchase_method_required_when_paid_check"
  CHECK ("immediate_payment" = 0 OR "payment_method_id" IS NOT NULL);

-- Payment status is a function of immediate vs total. The service
-- computes it on insert; the CHECK guards against drift.
ALTER TABLE "purchase"
  ADD CONSTRAINT "purchase_payment_status_shape_check"
  CHECK (
    ("immediate_payment" = 0                    AND "payment_status" = 'UNPAID') OR
    ("immediate_payment" = "payment_total"      AND "payment_status" = 'PAID')  OR
    ("immediate_payment" > 0                    AND
     "immediate_payment" < "payment_total"      AND "payment_status" = 'PARTIALLY_PAID')
  );

-- §7.7  sale (mirror)

ALTER TABLE "sale"
  ADD CONSTRAINT "sale_two_currencies_check"
  CHECK ("delivered_currency_id" <> "payment_currency_id");

ALTER TABLE "sale"
  ADD CONSTRAINT "sale_amounts_positive_check"
  CHECK (
    "delivered_amount" > 0 AND
    "payment_total" > 0 AND
    "rate" > 0 AND
    "immediate_payment" >= 0
  );

ALTER TABLE "sale"
  ADD CONSTRAINT "sale_outstanding_matches_check"
  CHECK ("outstanding_amount" = "payment_total" - "immediate_payment");

ALTER TABLE "sale"
  ADD CONSTRAINT "sale_immediate_le_total_check"
  CHECK ("immediate_payment" <= "payment_total");

ALTER TABLE "sale"
  ADD CONSTRAINT "sale_rate_total_exact_check"
  CHECK ("payment_total" = "delivered_amount" * "rate");

ALTER TABLE "sale"
  ADD CONSTRAINT "sale_method_required_when_paid_check"
  CHECK ("immediate_payment" = 0 OR "payment_method_id" IS NOT NULL);

ALTER TABLE "sale"
  ADD CONSTRAINT "sale_payment_status_shape_check"
  CHECK (
    ("immediate_payment" = 0                    AND "payment_status" = 'UNPAID') OR
    ("immediate_payment" = "payment_total"      AND "payment_status" = 'PAID')  OR
    ("immediate_payment" > 0                    AND
     "immediate_payment" < "payment_total"      AND "payment_status" = 'PARTIALLY_PAID')
  );

-- Snapshotted profit fields are non-negative in the happy path but a
-- loss is real (bureau sells USD below cost), so gross_profit_mru is
-- unbounded. cost_of_currency_sold_mru is always >= 0.
ALTER TABLE "sale"
  ADD CONSTRAINT "sale_cost_of_sold_nonneg_check"
  CHECK ("cost_of_currency_sold_mru" >= 0);

-- Exactly one leg is the base currency (D-019). Trigger reads
-- settings.base_currency_id; both purchase and sale share the fn.
CREATE OR REPLACE FUNCTION check_trade_has_base_leg()
RETURNS TRIGGER AS $$
DECLARE base_id UUID;
BEGIN
  SELECT base_currency_id INTO base_id FROM settings WHERE id = 1;
  IF base_id IS NULL THEN
    RAISE EXCEPTION 'settings.base_currency_id is not initialized; refusing trade write'
      USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.delivered_currency_id = base_id) = (NEW.payment_currency_id = base_id) THEN
    RAISE EXCEPTION 'exactly one leg must be the base currency (D-019)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER purchase_base_leg_trigger
  BEFORE INSERT OR UPDATE ON "purchase"
  FOR EACH ROW EXECUTE FUNCTION check_trade_has_base_leg();

CREATE TRIGGER sale_base_leg_trigger
  BEFORE INSERT OR UPDATE ON "sale"
  FOR EACH ROW EXECUTE FUNCTION check_trade_has_base_leg();

-- REVOKE DELETE — reversal soft-flips to status='REVERSED', never
-- deletes. Guarded so the shadow DB (no currency_app role) still
-- applies cleanly.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'currency_app') THEN
    REVOKE DELETE ON TABLE "purchase" FROM currency_app;
    REVOKE DELETE ON TABLE "sale" FROM currency_app;
  END IF;
END $$;
