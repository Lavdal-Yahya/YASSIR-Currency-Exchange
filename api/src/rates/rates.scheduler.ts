import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RatesService } from './rates.service.js';

// RatesRefreshScheduler — runs RatesService.refresh() once daily (P8-04).
//
// 06:00 local. The @nestjs/schedule module handles the cron loop; we
// wrap the refresh call so any exception is logged instead of crashing
// the process (a rate feed hiccup must not take down the API).
//
// The scheduler is a no-op during tests — vitest sets NODE_ENV=test
// and we exit early to keep the suite deterministic (no ambient
// side effects between test files).

@Injectable()
export class RatesRefreshScheduler {
  private readonly logger = new Logger(RatesRefreshScheduler.name);

  constructor(private readonly rates: RatesService) {}

  @Cron(CronExpression.EVERY_DAY_AT_6AM, { name: 'rates-daily-refresh' })
  async refreshDaily(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    try {
      const result = await this.rates.refresh();
      this.logger.log(`daily rate refresh: ${result.refreshed} succeeded, ${result.failed} failed`);
    } catch (err) {
      this.logger.error(`daily rate refresh crashed: ${(err as Error).message ?? err}`);
    }
  }
}
