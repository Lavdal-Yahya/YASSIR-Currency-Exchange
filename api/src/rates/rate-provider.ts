import { Decimal } from '../common/money.js';

// RateProvider — pluggable source of market rates (P8-01).
//
// Non-authoritative feed. `RateService` calls this to build the
// "suggested rate" chip; nothing about trade math depends on the
// return value. A provider that fails or omits a currency is not an
// error — the previous snapshot stays in place.
//
// Two implementations ship in P8:
//   · OpenErApiProvider — hits open.er-api.com (free, no API key).
//   · FixedRateProvider — deterministic values, used in tests so
//     they never touch the network.

export interface RateProviderResult {
  code: string;
  midRateMru: Decimal;
}

export interface RateProvider {
  readonly name: string;
  fetch(baseCode: string, targetCodes: string[]): Promise<RateProviderResult[]>;
}

// Injection token — services depend on the token, the module binds
// the concrete provider. Test-only wiring can override it.
export const RATE_PROVIDER = Symbol('RATE_PROVIDER');
