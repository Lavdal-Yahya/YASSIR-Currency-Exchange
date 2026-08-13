import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller.js';
import { ProfitService } from './profit.service.js';
import { UserActivityService } from './user-activity.service.js';
import { DashboardService } from './dashboard.service.js';
import { CashFlowService } from './cash-flow.service.js';
import { AgeingReportService } from './ageing.service.js';

@Module({
  controllers: [ReportsController],
  providers: [
    ProfitService,
    UserActivityService,
    DashboardService,
    CashFlowService,
    AgeingReportService,
  ],
  exports: [
    ProfitService,
    UserActivityService,
    DashboardService,
    CashFlowService,
    AgeingReportService,
  ],
})
export class ReportsModule {}
