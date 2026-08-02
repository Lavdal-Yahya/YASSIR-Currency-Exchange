-- CreateTable
CREATE TABLE "payment_method" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label_fr" TEXT NOT NULL,
    "label_ar" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "requires_note" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payment_method_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_method_code_key" ON "payment_method"("code");

-- Hand-added constraints (raw SQL — Prisma cannot express these).

-- Codes are stable identifiers referenced from ledger entries and audit
-- rows. Keep them uppercase alphanumeric + underscore, 2-32 chars.
ALTER TABLE "payment_method"
  ADD CONSTRAINT "payment_method_code_shape"
  CHECK ("code" ~ '^[A-Z][A-Z0-9_]{1,31}$');

-- No DELETE grant on the app role. Historical ledger entries reference
-- payment_method rows by id — a delete would strand them.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'currency_app') THEN
    REVOKE DELETE ON "payment_method" FROM "currency_app";
  END IF;
END$$;
