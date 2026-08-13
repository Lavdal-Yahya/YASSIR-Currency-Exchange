import { Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { PERMISSIONS } from '../common/permissions.js';
import { ListHistoryDto } from './dto/list-history.dto.js';
import {
  type CurrentRateRow,
  type RateHistoryRow,
  RatesService,
  type RefreshResult,
} from './rates.service.js';

@Controller('rates')
export class RatesController {
  constructor(private readonly rates: RatesService) {}

  // Current snapshot per active non-base currency. Employee-accessible so
  // the trade form can render the "Suggested rate" chip.
  @RequirePermission(PERMISSIONS.RATE_READ)
  @Get()
  async list(): Promise<CurrentRateRow[]> {
    return this.rates.current();
  }

  // History for one currency, most-recent first. Same permission — the
  // owner will typically be the one browsing history but employees can
  // see it too.
  @RequirePermission(PERMISSIONS.RATE_READ)
  @Get('history')
  async history(@Query() query: ListHistoryDto): Promise<RateHistoryRow[]> {
    return this.rates.history(query.currencyId, query.limit ?? 30);
  }

  // Manual trigger — owner-only. The scheduler (P8-04) runs it daily;
  // this endpoint exists for "the rate on screen looks stale, refresh now"
  // moments.
  @RequirePermission(PERMISSIONS.RATE_MANAGE)
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  async refresh(): Promise<RefreshResult> {
    return this.rates.refresh();
  }
}
