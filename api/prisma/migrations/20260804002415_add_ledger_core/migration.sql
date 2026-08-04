-- P3-01 · ledger core migration.
--
-- Four tables plus their raw-SQL constraints, triggers, and REVOKE DELETE
-- grants — every hand-added statement below is pasted from
-- docs/schema-review.md §7.1–7.4 (signed off 2026-08-04). A CHECK on paper
-- is not a CHECK in the database; a regenerated migration silently drops
-- the hand edits, which is why the pre-commit self-review checklist
-- (conventions §1 item 6) exists.
--
-- ORDERING NOTE. currency_ledger.sequence defaults to
-- nextval('ledger_sequence_seq'::regclass); the sequence must exist before
-- the CREATE TABLE runs. CREATE SEQUENCE therefore sits at the very top,
-- ahead of the Prisma-generated body. (D-023 item 1: one global sequence,
-- not per-currency.)

-- CreateSequence (D-023 item 1 — global, not per-currency)
CREATE SEQUENCE "ledger_sequence_seq" AS BIGINT START 1;

-- CreateEnum
CREATE TYPE "ledger_direction" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "cost_movement_kind" AS ENUM ('ACQUISITION', 'DISPOSAL');

-- CreateTable
CREATE TABLE "currency_ledger" (
    "id" BIGSERIAL NOT NULL,
    "currency_id" UUID NOT NULL,
    "direction" "ledger_direction" NOT NULL,
    "amount" DECIMAL(24,4) NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" UUID,
    "payment_method_id" UUID,
    "note" TEXT,
    "transaction_date" TIMESTAMPTZ(6) NOT NULL,
    "sequence" BIGINT NOT NULL DEFAULT nextval('ledger_sequence_seq'::regclass),
    "description" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "currency_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "currency_balance" (
    "currency_id" UUID NOT NULL,
    "cached_amount" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "currency_balance_pkey" PRIMARY KEY ("currency_id")
);

-- CreateTable
CREATE TABLE "cost_movement" (
    "id" BIGSERIAL NOT NULL,
    "currency_id" UUID NOT NULL,
    "ledger_entry_id" BIGINT NOT NULL,
    "kind" "cost_movement_kind" NOT NULL,
    "quantity" DECIMAL(24,4) NOT NULL,
    "unit_cost_mru" DECIMAL(24,8) NOT NULL,
    "realized_pnl_mru" DECIMAL(24,4),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sequence" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cost_movement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "currency_cost" (
    "currency_id" UUID NOT NULL,
    "cached_avg_mru" DECIMAL(24,8) NOT NULL DEFAULT 0,
    "cached_quantity" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "currency_cost_pkey" PRIMARY KEY ("currency_id")
);

-- CreateIndex
CREATE INDEX "currency_ledger_currency_sequence_idx" ON "currency_ledger"("currency_id", "sequence");

-- CreateIndex
CREATE INDEX "currency_ledger_source_idx" ON "currency_ledger"("source_type", "source_id");

-- CreateIndex
CREATE INDEX "currency_ledger_transaction_date_idx" ON "currency_ledger"("transaction_date" DESC);

-- CreateIndex
CREATE INDEX "currency_ledger_creator_created_idx" ON "currency_ledger"("created_by_user_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "cost_movement_ledger_entry_id_key" ON "cost_movement"("ledger_entry_id");

-- CreateIndex
CREATE INDEX "cost_movement_currency_sequence_idx" ON "cost_movement"("currency_id", "sequence");

-- AddForeignKey
ALTER TABLE "currency_ledger" ADD CONSTRAINT "currency_ledger_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "currency_ledger" ADD CONSTRAINT "currency_ledger_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "payment_method"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "currency_ledger" ADD CONSTRAINT "currency_ledger_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "currency_balance" ADD CONSTRAINT "currency_balance_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_movement" ADD CONSTRAINT "cost_movement_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_movement" ADD CONSTRAINT "cost_movement_ledger_entry_id_fkey" FOREIGN KEY ("ledger_entry_id") REFERENCES "currency_ledger"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "currency_cost" ADD CONSTRAINT "currency_cost_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-added below. Verbatim from docs/schema-review.md §7.1–7.4.
-- Regenerating this migration will silently drop everything below this line;
-- the self-review checklist (conventions §1 item 6) is the only defence.
-- ---------------------------------------------------------------------------

-- §7.1  currency_ledger

-- Direction carries sign; the amount is always positive magnitude.
ALTER TABLE "currency_ledger"
  ADD CONSTRAINT "currency_ledger_amount_positive_check"
  CHECK ("amount" > 0);

-- Openings are the only source_type allowed to have a NULL source_id.
-- Every other source_type must link to its row. `opening_balance` is not
-- yet a table (P3-08, PR-B), but the constraint takes today; the
-- application layer will not write any source_type other than the
-- planned set (opening_balance / purchase / sale / payment / expense).
ALTER TABLE "currency_ledger"
  ADD CONSTRAINT "currency_ledger_source_link_check"
  CHECK ("source_id" IS NOT NULL OR "source_type" = 'opening_balance');

-- payment_method_id required for payment + expense movements. Trades'
-- immediate-payment leg is enforced contextually in the service; the DB
-- guarantees the baseline. `opening_balance` on the currency it credits
-- doesn't move external cash — carries a NULL method (D-020, schema
-- review §2.1 last paragraph).
ALTER TABLE "currency_ledger"
  ADD CONSTRAINT "currency_ledger_method_required_for_cash_check"
  CHECK (
    "source_type" NOT IN ('payment', 'expense') OR "payment_method_id" IS NOT NULL
  );

-- Reversal soft-deletes via is_active=false. The application role never
-- DELETEs a ledger row. Guarded so the shadow DB used by
-- `prisma migrate dev` (no `currency_app` role) still applies cleanly.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'currency_app') THEN
    REVOKE DELETE ON TABLE "currency_ledger" FROM currency_app;
  END IF;
END $$;


-- §7.2  currency_balance

-- Non-base currencies cannot hold a negative balance. Base MRU may be
-- overridden by an owner (D-015); refusing MRU at the DB level would
-- remove that recovery path. A partial CHECK cannot reference another
-- table, so this is a trigger that reads the singleton settings row.
-- The settings row is guaranteed to exist by the P2-02 seed and by the
-- settings_singleton CHECK (id = 1).
CREATE OR REPLACE FUNCTION check_non_base_balance_nonneg()
RETURNS TRIGGER AS $$
DECLARE base_id UUID;
BEGIN
  SELECT base_currency_id INTO base_id FROM settings WHERE id = 1;
  IF base_id IS NULL THEN
    RAISE EXCEPTION 'settings.base_currency_id is not initialized; refusing balance write'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.currency_id <> base_id AND NEW.cached_amount < 0 THEN
    RAISE EXCEPTION 'non-base currency balance cannot go negative'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER currency_balance_nonneg_trigger
  BEFORE INSERT OR UPDATE ON "currency_balance"
  FOR EACH ROW EXECUTE FUNCTION check_non_base_balance_nonneg();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'currency_app') THEN
    REVOKE DELETE ON TABLE "currency_balance" FROM currency_app;
  END IF;
END $$;


-- §7.3  cost_movement

ALTER TABLE "cost_movement"
  ADD CONSTRAINT "cost_movement_quantity_positive_check"
  CHECK ("quantity" > 0);

ALTER TABLE "cost_movement"
  ADD CONSTRAINT "cost_movement_unit_cost_positive_check"
  CHECK ("unit_cost_mru" > 0);

-- Realized P&L is null on acquisitions and required on disposals.
ALTER TABLE "cost_movement"
  ADD CONSTRAINT "cost_movement_pnl_shape_check"
  CHECK (
    ("kind" = 'ACQUISITION' AND "realized_pnl_mru" IS NULL) OR
    ("kind" = 'DISPOSAL' AND "realized_pnl_mru" IS NOT NULL)
  );

-- One cost row per ledger row — enforced by the Prisma-generated
-- cost_movement_ledger_entry_id_key unique index above; noted here for
-- symmetry with the schema-review.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'currency_app') THEN
    REVOKE DELETE ON TABLE "cost_movement" FROM currency_app;
  END IF;
END $$;


-- §7.4  currency_cost

-- Cached quantity must be non-negative for the same reason as balance,
-- with the same base-currency exception. Same trigger pattern as §7.2.
CREATE OR REPLACE FUNCTION check_currency_cost_nonneg()
RETURNS TRIGGER AS $$
DECLARE base_id UUID;
BEGIN
  SELECT base_currency_id INTO base_id FROM settings WHERE id = 1;
  IF base_id IS NULL THEN
    RAISE EXCEPTION 'settings.base_currency_id is not initialized; refusing cost write'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.currency_id <> base_id AND NEW.cached_quantity < 0 THEN
    RAISE EXCEPTION 'non-base cached_quantity cannot go negative'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER currency_cost_nonneg_trigger
  BEFORE INSERT OR UPDATE ON "currency_cost"
  FOR EACH ROW EXECUTE FUNCTION check_currency_cost_nonneg();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'currency_app') THEN
    REVOKE DELETE ON TABLE "currency_cost" FROM currency_app;
  END IF;
END $$;
