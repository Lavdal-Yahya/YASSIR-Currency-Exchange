-- P8-01 · rate_snapshot table (non-authoritative market rate cache)
-- Per schema-review §6.1 and §7.10.

CREATE TABLE "rate_snapshot" (
    "id"           BIGSERIAL NOT NULL,
    "currency_id"  UUID NOT NULL,
    "mid_rate_mru" DECIMAL(24,8) NOT NULL,
    "source"       TEXT NOT NULL,
    "fetched_at"   TIMESTAMPTZ(6) NOT NULL,
    "is_current"   BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "rate_snapshot_pkey" PRIMARY KEY ("id")
);

-- FK: never orphan a rate snapshot when a currency is deactivated;
-- currency deletion is RESTRICTed by the app role anyway.
ALTER TABLE "rate_snapshot"
    ADD CONSTRAINT "rate_snapshot_currency_id_fkey"
    FOREIGN KEY ("currency_id") REFERENCES "currency"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- schema-review §7.10: mid_rate_mru is a strictly positive market rate.
ALTER TABLE "rate_snapshot"
    ADD CONSTRAINT "rate_snapshot_positive_check"
    CHECK ("mid_rate_mru" > 0);

-- History reads: (currency, fetched_at DESC) is the index the /rates/history
-- endpoint hits.
CREATE INDEX "rate_snapshot_currency_fetched_idx"
    ON "rate_snapshot"("currency_id", "fetched_at" DESC);

-- Only one row per currency has is_current = true at any moment
-- (schema-review §7.10). RateService.refresh flips the old row's flag
-- before inserting the new one in a single transaction; this partial
-- unique index is the DB-level guarantee.
CREATE UNIQUE INDEX "rate_snapshot_current_unique"
    ON "rate_snapshot"("currency_id") WHERE "is_current" = true;

-- No DELETE for the app role. History is preserved for post-hoc analysis
-- (D-023 item 6). Guard for the shadow DB.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'currency_app') THEN
    REVOKE DELETE ON TABLE "rate_snapshot" FROM currency_app;
  END IF;
END $$;
