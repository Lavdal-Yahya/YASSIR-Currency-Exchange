import { Controller, Get, Query } from '@nestjs/common';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { PERMISSIONS } from '../common/permissions.js';
import { ProfitQueryDto } from './dto/profit-query.dto.js';
import { UserActivityQueryDto } from './dto/user-activity-query.dto.js';
import { ProfitService, type ProfitReport } from './profit.service.js';
import { UserActivityService, type UserActivityRow } from './user-activity.service.js';

@Controller('reports')
export class ReportsController {
  constructor(
    private readonly profit: ProfitService,
    private readonly activity: UserActivityService,
  ) {}

  // Profit report — owner/finance-only. Employees never see profit
  // (D-018 applies at the serializer for trade rows; this endpoint is
  // gated on the more specific PROFIT_VIEW permission because the whole
  // response is profit data).
  @RequirePermission(PERMISSIONS.PROFIT_VIEW)
  @Get('profit')
  async profitReport(@Query() query: ProfitQueryDto): Promise<ProfitReport> {
    return this.profit.report(new Date(query.from), new Date(query.to), query.currencyId);
  }

  // User-activity report — owner-only (audit permission).
  @RequirePermission(PERMISSIONS.AUDIT_READ)
  @Get('user-activity')
  async userActivity(@Query() query: UserActivityQueryDto): Promise<UserActivityRow[]> {
    return this.activity.report(new Date(query.from), new Date(query.to));
  }
}
