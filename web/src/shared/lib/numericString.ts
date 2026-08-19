// Decimal separator normalizer — mobile keyboards on Arabic/French locales emit
// "," as the decimal separator even when inputMode="decimal" is set. The regexes
// accept either separator so validation passes; normalizeDecimal converts to "."
// before the value is sent to the backend (which only accepts ".").

export const AMOUNT_RE = /^\d+([.,]\d{1,4})?$/;
export const RATE_RE = /^\d+([.,]\d{1,8})?$/;
export const THRESHOLD_RE = /^\d+([.,]\d+)?$/;

/** Replace a comma decimal separator with a period. Safe to call on any string. */
export function normalizeDecimal(s: string): string {
  return s.trim().replace(',', '.');
}
