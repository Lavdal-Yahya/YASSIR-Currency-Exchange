-- CreateTable
CREATE TABLE "currency" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT,
    "decimal_places" SMALLINT NOT NULL,
    "low_balance_threshold" DECIMAL(24,4),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "currency_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "currency_code_key" ON "currency"("code");

-- Hand-added constraints. Prisma cannot express these; re-generating the
-- migration would silently drop them (conventions §1 self-review item 6).

-- decimal_places is 0..6 in every currency we plan to touch. JPY=0, USD=2,
-- most currencies=2, a few precious-metal/bookkeeping cases up to 6.
-- Anything larger is a data-entry error, not a currency.
ALTER TABLE "currency"
  ADD CONSTRAINT "currency_decimal_places_range"
  CHECK ("decimal_places" BETWEEN 0 AND 6);

-- low_balance_threshold, when set, must be strictly positive — a zero
-- threshold is a permanent warning, a negative one is nonsense.
ALTER TABLE "currency"
  ADD CONSTRAINT "currency_low_balance_threshold_positive"
  CHECK ("low_balance_threshold" IS NULL OR "low_balance_threshold" > 0);

-- ISO 4217 codes are three uppercase letters; we allow 3-10 for future
-- internal codes. The letters/digits-only rule keeps a wayward lowercase
-- or space from landing.
ALTER TABLE "currency"
  ADD CONSTRAINT "currency_code_shape"
  CHECK ("code" ~ '^[A-Z0-9]{3,10}$');

-- Financial-adjacent tables get no DELETE grant on the app role. The
-- guard is idempotent: if the role does not exist yet in this
-- environment (fresh local dev), skip silently. Prod always has it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'currency_app') THEN
    REVOKE DELETE ON "currency" FROM "currency_app";
  END IF;
END$$;
