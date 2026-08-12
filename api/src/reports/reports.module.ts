import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller.js';
import { ProfitService } from './profit.service.js';
import { UserActivityService } from './user-activity.service.js';

@Module({
  controllers: [ReportsController],
  providers: [ProfitService, UserActivityService],
  exports: [ProfitService, UserActivityService],
})
export class ReportsModule {}
