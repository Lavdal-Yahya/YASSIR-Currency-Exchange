-- CreateTable
CREATE TABLE "settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "base_currency_id" UUID NOT NULL,
    "business_timezone" TEXT NOT NULL DEFAULT 'Africa/Nouakchott',
    "negative_balance_override_allowed" BOOLEAN NOT NULL DEFAULT false,
    "go_live_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by_user_id" UUID,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "settings" ADD CONSTRAINT "settings_base_currency_id_fkey" FOREIGN KEY ("base_currency_id") REFERENCES "currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-added constraints. Re-generating the migration would drop these.

-- Enforce the singleton at the DB, not just in the service. A second row
-- is an impossibility, not a bug we might notice in review.
ALTER TABLE "settings"
  ADD CONSTRAINT "settings_singleton"
  CHECK ("id" = 1);

-- IANA tz identifiers can be validated by trying to CAST — Postgres knows
-- the set. We only allow non-empty text and a shape that could plausibly
-- be an IANA identifier ("Africa/Nouakchott", "Europe/Paris", "UTC").
ALTER TABLE "settings"
  ADD CONSTRAINT "settings_business_timezone_shape"
  CHECK (
    "business_timezone" ~ '^[A-Za-z_]+(/[A-Za-z_]+)*$'
    OR "business_timezone" = 'UTC'
  );

-- No DELETE grant on the app role for this table either — the singleton
-- exists for the life of the deployment.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'currency_app') THEN
    REVOKE DELETE ON "settings" FROM "currency_app";
  END IF;
END$$;
