import { Module } from '@nestjs/common';
import { OpenErApiProvider } from './open-er-api.provider.js';
import { RATE_PROVIDER } from './rate-provider.js';
import { RatesController } from './rates.controller.js';
import { RatesRefreshScheduler } from './rates.scheduler.js';
import { RatesService } from './rates.service.js';

// RatesModule — market-rate snapshots (P8). Read-only against the ledger.
// The provider is bound to the injection token so tests can override
// with a deterministic implementation without touching production wiring.

@Module({
  controllers: [RatesController],
  providers: [
    RatesService,
    RatesRefreshScheduler,
    { provide: RATE_PROVIDER, useClass: OpenErApiProvider },
  ],
  exports: [RatesService, RATE_PROVIDER],
})
export class RatesModule {}
