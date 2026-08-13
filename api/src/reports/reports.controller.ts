import { Controller, Get, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { Readable } from 'node:stream';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { PERMISSIONS } from '../common/permissions.js';
import { CashFlowQueryDto } from './dto/cash-flow-query.dto.js';
import { ProfitQueryDto } from './dto/profit-query.dto.js';
import { UserActivityQueryDto } from './dto/user-activity-query.dto.js';
import { AgeingReportService, type AgeingReport } from './ageing.service.js';
import { CashFlowService, type CashFlowReport } from './cash-flow.service.js';
import { DashboardService, type DashboardSummary } from './dashboard.service.js';
import { ProfitService, type ProfitReport } from './profit.service.js';
import { UserActivityService, type UserActivityRow } from './user-activity.service.js';

@Controller('reports')
export class ReportsController {
  constructor(
    private readonly profit: ProfitService,
    private readonly activity: UserActivityService,
    private readonly dashboard: DashboardService,
    private readonly cashFlow: CashFlowService,
    private readonly ageing: AgeingReportService,
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

  // Dashboard operational summary (P7-01). Balance:read is sufficient —
  // employees can see today's activity and open debt counts.
  @RequirePermission(PERMISSIONS.BALANCE_READ)
  @Get('dashboard')
  async dashboardSummary(): Promise<DashboardSummary> {
    return this.dashboard.summary(new Date());
  }

  // Cash-flow by payment method (P7-02) — Bankily/Masrivi reconciliation.
  // Supports ?format=csv for spreadsheet export.
  @RequirePermission(PERMISSIONS.REPORT_VIEW)
  @Get('cash-flow')
  async cashFlowReport(
    @Query() query: CashFlowQueryDto,
    @Query('format') format: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CashFlowReport | StreamableFile> {
    const report = await this.cashFlow.report(new Date(query.from), new Date(query.to));
    if (format === 'csv') {
      return toCsvFile(res, cashFlowToCsv(report), 'cash-flow');
    }
    return report;
  }

  // Debt ageing report (P7-03). Supports ?format=csv.
  @RequirePermission(PERMISSIONS.REPORT_VIEW)
  @Get('ageing')
  async ageingReport(
    @Query('format') format: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AgeingReport | StreamableFile> {
    const report = await this.ageing.report(new Date());
    if (format === 'csv') {
      return toCsvFile(res, ageingToCsv(report), 'ageing');
    }
    return report;
  }
}

// ----- CSV helpers --------------------------------------------------------

function toCsvFile(res: Response, csv: string, name: string): StreamableFile {
  const date = new Date().toISOString().slice(0, 10);
  res.set({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${name}-${date}.csv"`,
  });
  return new StreamableFile(Readable.from([csv]));
}

function escapeCsv(value: string | number): string {
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function cashFlowToCsv(report: CashFlowReport): string {
  const lines: string[] = ['Method,Currency,Credits,Debits'];
  for (const method of report.methods) {
    for (const leg of method.byLeg) {
      lines.push(
        [method.paymentMethodName, leg.currencyCode, leg.creditsTotal, leg.debitsTotal]
          .map(escapeCsv)
          .join(','),
      );
    }
  }
  return lines.join('\n');
}

function ageingToCsv(report: AgeingReport): string {
  const lines: string[] = ['Type,Bucket,Currency,Count,Total'];
  const sections: [string, typeof report.receivables][] = [
    ['receivable', report.receivables],
    ['payable', report.payables],
  ];
  const buckets: [string, keyof typeof report.receivables][] = [
    ['0-30', 'current'],
    ['31-60', 'bucket31to60'],
    ['61-90', 'bucket61to90'],
    ['91+', 'bucket91plus'],
  ];
  for (const [type, section] of sections) {
    for (const [label, key] of buckets) {
      const bucket = section[key];
      if (bucket.count === 0) continue;
      for (const cur of bucket.byCurrency) {
        lines.push(
          [type, label, cur.currencyCode, bucket.count, cur.total].map(escapeCsv).join(','),
        );
      }
    }
  }
  return lines.join('\n');
}
