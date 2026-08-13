import { Injectable, Logger } from '@nestjs/common';
import { Decimal } from '../common/money.js';
import type { RateProvider, RateProviderResult } from './rate-provider.js';

// OpenErApiProvider — hits https://open.er-api.com/v6/latest/{base}.
// Free, no API key. Response shape:
//   { result: 'success', base_code: 'MRU', rates: { USD: 0.025, ... } }
//
// The response's `rates[X]` is "how many X units for one MRU". We store
// mid_rate_mru = "how many MRU per one X" = 1 / rates[X], which matches
// the direction the trade form expects ("1 USD = ? MRU").
//
// Provider failures (network, non-2xx, malformed body) throw and let
// RateService catch — the service treats a throw as a per-currency
// failure and leaves the previous snapshot untouched.

@Injectable()
export class OpenErApiProvider implements RateProvider {
  readonly name = 'open.er-api.com';
  private readonly logger = new Logger(OpenErApiProvider.name);
  private readonly endpoint = 'https://open.er-api.com/v6/latest';

  async fetch(baseCode: string, targetCodes: string[]): Promise<RateProviderResult[]> {
    const res = await globalThis.fetch(`${this.endpoint}/${baseCode}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`open.er-api.com returned HTTP ${res.status}`);
    }
    const body = (await res.json()) as { result?: string; rates?: Record<string, number> };
    if (body.result !== 'success' || !body.rates) {
      throw new Error(`open.er-api.com returned unexpected body`);
    }
    const results: RateProviderResult[] = [];
    for (const code of targetCodes) {
      const perOne = body.rates[code];
      if (typeof perOne !== 'number' || perOne <= 0) {
        this.logger.warn(`no rate for ${code} in provider response`);
        continue;
      }
      // Invert: rates[X] = X per 1 MRU; we want MRU per 1 X.
      const midRateMru = new Decimal(1).div(new Decimal(perOne));
      results.push({ code, midRateMru });
    }
    return results;
  }
}
