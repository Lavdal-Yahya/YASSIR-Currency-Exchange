-- P3-08 / P3-09 · openings + debt skeleton.
--
-- Adds opening_balance (P3-08) and the receivable / payable skeletons
-- (P3-09 + carrier for P4/P5). Full debt lifecycle lands in P5; this
-- migration only creates enough for opening debts to have somewhere
-- to live.
--
-- NOTE. Prisma tried to `DROP SEQUENCE ledger_sequence_seq;` on
-- generation because it didn't recognise the sequence created by hand
-- in 20260804002415_add_ledger_core. That block has been removed
-- deliberately — dropping the sequence would break every future
-- ledger write.

-- CreateEnum
CREATE TYPE "debt_origin" AS ENUM ('TRADE', 'OPENING');

-- CreateEnum
CREATE TYPE "debt_status" AS ENUM ('OPEN', 'CLOSED', 'REVERSED');

-- CreateEnum
CREATE TYPE "debt_payment_status" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'PAID');

-- CreateTable
CREATE TABLE "opening_balance" (
    "id" UUID NOT NULL,
    "currency_id" UUID NOT NULL,
    "quantity" DECIMAL(24,4) NOT NULL,
    "opening_avg_cost_mru" DECIMAL(24,8) NOT NULL,
    "effective_date" DATE NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opening_balance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receivable" (
    "id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "currency_id" UUID NOT NULL,
    "original_amount" DECIMAL(24,4) NOT NULL,
    "outstanding_amount" DECIMAL(24,4) NOT NULL,
    "origin" "debt_origin" NOT NULL,
    "source_type" TEXT,
    "source_id" UUID,
    "status" "debt_status" NOT NULL DEFAULT 'OPEN',
    "payment_status" "debt_payment_status" NOT NULL DEFAULT 'UNPAID',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "receivable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payable" (
    "id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "currency_id" UUID NOT NULL,
    "original_amount" DECIMAL(24,4) NOT NULL,
    "outstanding_amount" DECIMAL(24,4) NOT NULL,
    "origin" "debt_origin" NOT NULL,
    "source_type" TEXT,
    "source_id" UUID,
    "status" "debt_status" NOT NULL DEFAULT 'OPEN',
    "payment_status" "debt_payment_status" NOT NULL DEFAULT 'UNPAID',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payable_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "opening_balance_currency_id_key" ON "opening_balance"("currency_id");

-- CreateIndex
CREATE INDEX "receivable_contact_currency_status_idx" ON "receivable"("contact_id", "currency_id", "status");

-- CreateIndex
CREATE INDEX "receivable_origin_source_idx" ON "receivable"("origin", "source_type", "source_id");

-- CreateIndex
CREATE INDEX "payable_contact_currency_status_idx" ON "payable"("contact_id", "currency_id", "status");

-- CreateIndex
CREATE INDEX "payable_origin_source_idx" ON "payable"("origin", "source_type", "source_id");

-- AddForeignKey
ALTER TABLE "opening_balance" ADD CONSTRAINT "opening_balance_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivable" ADD CONSTRAINT "receivable_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivable" ADD CONSTRAINT "receivable_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payable" ADD CONSTRAINT "payable_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payable" ADD CONSTRAINT "payable_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-added below. Verbatim from docs/schema-review.md §7.5 and §7.6.
-- ---------------------------------------------------------------------------

-- §7.5  opening_balance

ALTER TABLE "opening_balance"
  ADD CONSTRAINT "opening_balance_quantity_positive_check"
  CHECK ("quantity" > 0);

ALTER TABLE "opening_balance"
  ADD CONSTRAINT "opening_balance_avg_cost_positive_check"
  CHECK ("opening_avg_cost_mru" > 0);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'currency_app') THEN
    REVOKE DELETE ON TABLE "opening_balance" FROM currency_app;
  END IF;
END $$;


-- §7.6  receivable

ALTER TABLE "receivable"
  ADD CONSTRAINT "receivable_original_positive_check"
  CHECK ("original_amount" > 0);
ALTER TABLE "receivable"
  ADD CONSTRAINT "receivable_outstanding_nonneg_check"
  CHECK ("outstanding_amount" >= 0);
ALTER TABLE "receivable"
  ADD CONSTRAINT "receivable_outstanding_le_original_check"
  CHECK ("outstanding_amount" <= "original_amount");

-- origin=OPENING implies source is NULL; origin=TRADE implies both set.
ALTER TABLE "receivable"
  ADD CONSTRAINT "receivable_origin_source_shape_check"
  CHECK (
    ("origin" = 'OPENING' AND "source_type" IS NULL AND "source_id" IS NULL) OR
    ("origin" = 'TRADE' AND "source_type" IS NOT NULL AND "source_id" IS NOT NULL)
  );

-- payment_status = 'PAID' iff outstanding = 0. REVERSED rows escape this
-- lattice — their outstanding may be anything historical.
ALTER TABLE "receivable"
  ADD CONSTRAINT "receivable_paid_iff_zero_check"
  CHECK (
    "status" = 'REVERSED' OR
    ("payment_status" = 'PAID' AND "outstanding_amount" = 0) OR
    ("payment_status" <> 'PAID' AND "outstanding_amount" > 0)
  );

-- Immutability of original_amount enforced by trigger — CHECK cannot
-- reference OLD/NEW without one.
CREATE OR REPLACE FUNCTION receivable_original_amount_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.original_amount <> OLD.original_amount THEN
    RAISE EXCEPTION 'receivable.original_amount is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER receivable_original_amount_immutable_trigger
  BEFORE UPDATE ON "receivable"
  FOR EACH ROW EXECUTE FUNCTION receivable_original_amount_immutable();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'currency_app') THEN
    REVOKE DELETE ON TABLE "receivable" FROM currency_app;
  END IF;
END $$;


-- §7.6  payable (symmetric)

ALTER TABLE "payable"
  ADD CONSTRAINT "payable_original_positive_check"
  CHECK ("original_amount" > 0);
ALTER TABLE "payable"
  ADD CONSTRAINT "payable_outstanding_nonneg_check"
  CHECK ("outstanding_amount" >= 0);
ALTER TABLE "payable"
  ADD CONSTRAINT "payable_outstanding_le_original_check"
  CHECK ("outstanding_amount" <= "original_amount");

ALTER TABLE "payable"
  ADD CONSTRAINT "payable_origin_source_shape_check"
  CHECK (
    ("origin" = 'OPENING' AND "source_type" IS NULL AND "source_id" IS NULL) OR
    ("origin" = 'TRADE' AND "source_type" IS NOT NULL AND "source_id" IS NOT NULL)
  );

ALTER TABLE "payable"
  ADD CONSTRAINT "payable_paid_iff_zero_check"
  CHECK (
    "status" = 'REVERSED' OR
    ("payment_status" = 'PAID' AND "outstanding_amount" = 0) OR
    ("payment_status" <> 'PAID' AND "outstanding_amount" > 0)
  );

CREATE OR REPLACE FUNCTION payable_original_amount_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.original_amount <> OLD.original_amount THEN
    RAISE EXCEPTION 'payable.original_amount is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payable_original_amount_immutable_trigger
  BEFORE UPDATE ON "payable"
  FOR EACH ROW EXECUTE FUNCTION payable_original_amount_immutable();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'currency_app') THEN
    REVOKE DELETE ON TABLE "payable" FROM currency_app;
  END IF;
END $$;
