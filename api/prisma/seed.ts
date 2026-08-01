// Idempotent seed. Grows one phase at a time:
//   P1-04 — permission rows, OWNER + EMPLOYEE roles, bootstrap owner
//   P2-01 — MRU/USD/EUR currency rows (MRU first, base)
//   P2-05 — payment_method: CASH, BANKILY, MASRIVI, SEDAD, OTHER (D-020)
//   P2-02 — settings row (id=1) with MRU as base
//
// Run with `npm --workspace api run seed`. Uses upsert so re-running is
// safe on any environment.
//
// PrismaClient is imported dynamically because it does not exist until
// `prisma generate` runs, and `prisma generate` refuses to run against
// an empty schema. Both arrive together in P1-04.

async function main(): Promise<void> {
  console.warn(
    'seed: nothing to insert yet — schema is empty until P1-04 lands the auth models.',
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
