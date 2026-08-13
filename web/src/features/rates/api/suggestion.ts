import type { CurrentRate } from './useRates';

// suggestedRate — given a currency pair and the current-rates map,
// returns the market-suggested rate for the trade form's rate input.
//
// The form's rate input means "how many <payment> per 1 <delivered>".
// Snapshots store `mid_rate_mru` — MRU per 1 non-base unit. So:
//   - delivered = non-base, payment = MRU  → suggested = midRateMru
//   - delivered = MRU, payment = non-base  → suggested = 1 / midRateMru
//   - both MRU or both non-base            → no suggestion (D-019 rejects
//                                             the trade anyway)

export function suggestedRate(params: {
  rates: CurrentRate[] | undefined;
  deliveredCode: string | undefined;
  paymentCode: string | undefined;
  baseCode: string; // usually 'MRU'
}): { value: string; source: string; fetchedAt: string } | null {
  const { rates, deliveredCode, paymentCode, baseCode } = params;
  if (!rates || !deliveredCode || !paymentCode) return null;
  const deliveredIsBase = deliveredCode === baseCode;
  const paymentIsBase = paymentCode === baseCode;
  if (deliveredIsBase === paymentIsBase) return null; // 0 or 2 base legs
  const nonBaseCode = deliveredIsBase ? paymentCode : deliveredCode;
  const rate = rates.find((r) => r.currencyCode === nonBaseCode);
  if (!rate) return null;
  const mid = parseFloat(rate.midRateMru);
  if (!Number.isFinite(mid) || mid <= 0) return null;
  const value = deliveredIsBase ? (1 / mid).toFixed(8) : mid.toFixed(8);
  // Trim trailing zeros for display; keep at least 2 dp.
  const trimmed = value.replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1');
  return { value: trimmed, source: rate.source, fetchedAt: rate.fetchedAt };
}
