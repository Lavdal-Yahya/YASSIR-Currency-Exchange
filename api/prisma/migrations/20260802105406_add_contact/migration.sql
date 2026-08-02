-- CreateTable
CREATE TABLE "contact" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "is_customer" BOOLEAN NOT NULL DEFAULT true,
    "is_supplier" BOOLEAN NOT NULL DEFAULT false,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "contact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contact_phone_idx" ON "contact"("phone");

-- A contact must be a customer, a supplier, or both. Phase-2.md §3.
ALTER TABLE "contact"
  ADD CONSTRAINT "contact_role_present_check"
  CHECK ("is_customer" OR "is_supplier");

-- Name shape: non-empty after trim, max 120 chars. The DTO enforces the
-- same range; the DB check catches direct SQL inserts and seed drift.
ALTER TABLE "contact"
  ADD CONSTRAINT "contact_name_shape_check"
  CHECK (length(btrim("name")) BETWEEN 1 AND 120);

-- Phone shape when present: '+' followed by 6–15 digits. Matches the
-- application phone regex used by auth.
ALTER TABLE "contact"
  ADD CONSTRAINT "contact_phone_shape_check"
  CHECK ("phone" IS NULL OR "phone" ~ '^\+[0-9]{6,15}$');

-- The application role never deletes a contact. Archive-not-delete keeps
-- historical trades and debts readable (P4+). If the currency_app role
-- does not exist yet (fresh local dev / shadow DB), this is a no-op.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'currency_app') THEN
        REVOKE DELETE ON TABLE "contact" FROM currency_app;
    END IF;
END $$;
