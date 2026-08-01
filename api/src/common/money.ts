import { Decimal } from 'decimal.js';

// Monetary arithmetic — the type-and-runtime guard against IEEE-754.
//
// Rules (conventions §2 and §8, D-002):
//   - Money is Decimal in service code, string on the wire, NUMERIC(24,4)
//     in Postgres.
//   - A `number` never holds a monetary value. The runtime `assertNotNumber`
//     is belt-and-braces for the seam between HTTP and service, where an
//     accidental Number(input) would strip precision.
//   - Rounding is HALF_UP and always through `roundTo(amount, decimals)`
//     which reads the currency's `decimal_places` at the call site (D-009).
//
// Prisma also exposes its own `Prisma.Decimal`. We use `decimal.js`
// directly here to keep helpers free of a `@prisma/client` runtime
// dependency (so tests, scripts and future non-Nest tools can share
// them). The two are the same numeric type under the hood.
//
// Configure once, globally:
//   - precision high enough that intermediate multiplications don't lose
//     digits at typical rate scales (24 sig figures)
//   - ROUND_HALF_UP as the default rounding mode — D-009.

Decimal.set({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
});

export { Decimal };

// Type-branded string for money-shaped inputs on the wire. Keeping it as
// a plain string keeps DTOs boring; the brand is compile-only.
export type MoneyString = string & { readonly __brand?: 'MoneyString' };

// Runtime rejection. Not a type — an actual boot-time check that catches
// `roundTo(Number(input), 2)` when someone forgets D-002.
export function assertNotNumber(value: unknown, field = 'amount'): void {
  if (typeof value === 'number') {
    throw new TypeError(
      `${field} must not be a JavaScript number (D-002). Use string or Decimal.`,
    );
  }
}

// Half-up rounding to the currency's decimal places. This is the truth —
// the rounded value is what we store, so `outstanding = total − paid`
// never drifts by fractions of a minor unit (D-009).
export function roundTo(amount: Decimal | string, decimals: number): Decimal {
  assertNotNumber(amount);
  const d = amount instanceof Decimal ? amount : new Decimal(amount);
  return d.toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP);
}

// Format for the wire. Always a fixed-length string with the target
// decimal places; never scientific notation, never trailing zeros
// dropped. `formatMoney` in the frontend renders these.
export function toWire(amount: Decimal | string, decimals: number): MoneyString {
  const rounded = roundTo(amount, decimals);
  return rounded.toFixed(decimals) as MoneyString;
}

export function fromWire(s: MoneyString | string): Decimal {
  return new Decimal(s);
}
