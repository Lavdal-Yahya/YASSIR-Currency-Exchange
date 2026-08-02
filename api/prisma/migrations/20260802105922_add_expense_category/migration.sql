-- CreateTable
CREATE TABLE "expense_category" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "expense_category_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "expense_category_name_key" ON "expense_category"("name");

-- Name shape: non-empty after trim, max 60 chars. The DTO enforces the
-- same range; the DB check catches direct SQL inserts and seed drift.
ALTER TABLE "expense_category"
  ADD CONSTRAINT "expense_category_name_shape_check"
  CHECK (length(btrim("name")) BETWEEN 1 AND 60);

-- Deletion is refused at the application role. Historical expense rows
-- reference the category — deactivation hides it from the picker, delete
-- would rewrite the past. Guarded for fresh dev / shadow DB.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'currency_app') THEN
        REVOKE DELETE ON TABLE "expense_category" FROM currency_app;
    END IF;
END $$;
