-- P5-01 · payment / allocation / expense tables.
-- Adds the settlement layer on top of the debt skeletons from P3-09
-- (receivable / payable) and the ledger core from P3-01.
--
-- Three new enums, three tables, hand-added SQL per phase-5.md §2:
--   * CHECK (amount > 0) on all three tables.
--   * CHECK (allocation.target_type IN ('receivable', 'payable')).
--   * No FK from allocation.target_id — polymorphic column.
--   * Indexes per phase-5.md §2 for recomputation and list queries.
--   * REVOKE DELETE on all three tables for currency_app role.

-- CreateEnum
CREATE TYPE "payment_direction" AS ENUM ('RECEIVED_FROM_CUSTOMER', 'PAID_TO_SUPPLIER');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('CONFIRMED', 'REVERSED');

-- CreateEnum
CREATE TYPE "expense_status" AS ENUM ('CONFIRMED', 'REVERSED');

-- CreateTable
CREATE TABLE "payment" (
    "id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "currency_id" UUID NOT NULL,
    "amount" DECIMAL(24,4) NOT NULL,
    "direction" "payment_direction" NOT NULL,
    "payment_method_id" UUID NOT NULL,
    "payment_method_note" TEXT,
    "status" "payment_status" NOT NULL DEFAULT 'CONFIRMED',
    "reference" TEXT,
    "notes" TEXT,
    "transaction_date" TIMESTAMPTZ(6) NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allocation" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" UUID NOT NULL,
    "amount" DECIMAL(24,4) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "allocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense" (
    "id" UUID NOT NULL,
    "expense_category_id" UUID NOT NULL,
    "currency_id" UUID NOT NULL,
    "amount" DECIMAL(24,4) NOT NULL,
    "payment_method_id" UUID NOT NULL,
    "payment_method_note" TEXT,
    "description" TEXT NOT NULL,
    "status" "expense_status" NOT NULL DEFAULT 'CONFIRMED',
    "transaction_date" TIMESTAMPTZ(6) NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "expense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_contact_transaction_date_idx" ON "payment"("contact_id", "transaction_date" DESC);
CREATE INDEX "allocation_target_idx" ON "allocation"("target_type", "target_id");
CREATE INDEX "allocation_payment_idx" ON "allocation"("payment_id");
CREATE INDEX "expense_transaction_category_idx" ON "expense"("transaction_date" DESC, "expense_category_id");

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment" ADD CONSTRAINT "payment_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment" ADD CONSTRAINT "payment_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "payment_method"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment" ADD CONSTRAINT "payment_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "allocation" ADD CONSTRAINT "allocation_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expense" ADD CONSTRAINT "expense_expense_category_id_fkey" FOREIGN KEY ("expense_category_id") REFERENCES "expense_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expense" ADD CONSTRAINT "expense_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expense" ADD CONSTRAINT "expense_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "payment_method"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expense" ADD CONSTRAINT "expense_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-added below. Per phase-5.md §2.
-- ---------------------------------------------------------------------------

ALTER TABLE "payment"
  ADD CONSTRAINT "payment_amount_positive_check"
  CHECK ("amount" > 0);

ALTER TABLE "allocation"
  ADD CONSTRAINT "allocation_amount_positive_check"
  CHECK ("amount" > 0);

ALTER TABLE "allocation"
  ADD CONSTRAINT "allocation_target_type_check"
  CHECK ("target_type" IN ('receivable', 'payable'));

ALTER TABLE "expense"
  ADD CONSTRAINT "expense_amount_positive_check"
  CHECK ("amount" > 0);

-- REVOKE DELETE — reversal soft-flips status to 'REVERSED', nothing is ever
-- deleted. Guarded so the shadow DB (no currency_app role) applies cleanly.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'currency_app') THEN
    REVOKE DELETE ON TABLE "payment" FROM currency_app;
    REVOKE DELETE ON TABLE "allocation" FROM currency_app;
    REVOKE DELETE ON TABLE "expense" FROM currency_app;
  END IF;
END $$;
