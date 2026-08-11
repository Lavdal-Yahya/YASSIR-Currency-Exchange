import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import type { Payment, Receivable, Payable } from '@prisma/client';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { PERMISSIONS } from '../common/permissions.js';
import { startOfPeriod } from '../common/period.js';
import { PrismaService } from '../common/prisma.service.js';
import type { Paginated } from '../trades/trade-read.service.js';
import { AgeBucket, ListDebtsQueryDto, ListPaymentsQueryDto } from './dto/list-debts.dto.js';

// Age bucket → createdAt range. Cut-offs are the start of today in the
// business timezone (D-012) minus N calendar days, so a receivable born
// at 23:59 local yesterday is 1 day old — not 0 — and DST cannot shift
// the boundary. Buckets are inclusive on both ends by day count.
function ageBucketWhere(bucket: AgeBucket): { gte?: Date; lt?: Date } {
  const todayStart = startOfPeriod(new Date(), 'day');
  const daysAgo = (n: number) => new Date(todayStart.getTime() - n * 86_400_000);
  switch (bucket) {
    case '0-7':
      // age 0..7 → createdAt in [today-7d, +∞) but capped at now by data itself
      return { gte: daysAgo(7) };
    case '8-30':
      return { gte: daysAgo(30), lt: daysAgo(7) };
    case '31-60':
      return { gte: daysAgo(60), lt: daysAgo(30) };
    case '60+':
      return { lt: daysAgo(60) };
  }
}

@Controller()
export class PaymentsReadController {
  constructor(private readonly prisma: PrismaService) {}

  // ---- Payments ------------------------------------------------------------

  @RequirePermission(PERMISSIONS.PAYMENT_READ)
  @Get('payments')
  async listPayments(@Query() query: ListPaymentsQueryDto): Promise<Paginated<Payment>> {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    const where = {
      ...(query.contactId ? { contactId: query.contactId } : {}),
      ...(query.currencyId ? { currencyId: query.currencyId } : {}),
      ...(query.direction ? { direction: query.direction as never } : {}),
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            transactionDate: {
              ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
              ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
            },
          }
        : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.payment.findMany({
        where,
        orderBy: { transactionDate: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.payment.count({ where }),
    ]);
    return { data, total };
  }

  @RequirePermission(PERMISSIONS.PAYMENT_READ)
  @Get('payments/:id')
  async getPayment(@Param('id', new ParseUUIDPipe()) id: string): Promise<Payment> {
    const row = await this.prisma.payment.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Payment ${id} not found`);
    return row;
  }

  // ---- Receivables ---------------------------------------------------------

  @RequirePermission(PERMISSIONS.RECEIVABLE_READ)
  @Get('receivables')
  async listReceivables(@Query() query: ListDebtsQueryDto): Promise<Paginated<Receivable>> {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    const where = {
      ...(query.contactId ? { contactId: query.contactId } : {}),
      ...(query.currencyId ? { currencyId: query.currencyId } : {}),
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.paymentStatus ? { paymentStatus: query.paymentStatus as never } : {}),
      ...(query.ageBucket ? { createdAt: ageBucketWhere(query.ageBucket) } : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.receivable.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.receivable.count({ where }),
    ]);
    return { data, total };
  }

  @RequirePermission(PERMISSIONS.RECEIVABLE_READ)
  @Get('receivables/:id')
  async getReceivable(@Param('id', new ParseUUIDPipe()) id: string): Promise<Receivable> {
    const row = await this.prisma.receivable.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Receivable ${id} not found`);
    return row;
  }

  // ---- Payables ------------------------------------------------------------

  @RequirePermission(PERMISSIONS.PAYABLE_READ)
  @Get('payables')
  async listPayables(@Query() query: ListDebtsQueryDto): Promise<Paginated<Payable>> {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    const where = {
      ...(query.contactId ? { contactId: query.contactId } : {}),
      ...(query.currencyId ? { currencyId: query.currencyId } : {}),
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.paymentStatus ? { paymentStatus: query.paymentStatus as never } : {}),
      ...(query.ageBucket ? { createdAt: ageBucketWhere(query.ageBucket) } : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.payable.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.payable.count({ where }),
    ]);
    return { data, total };
  }

  @RequirePermission(PERMISSIONS.PAYABLE_READ)
  @Get('payables/:id')
  async getPayable(@Param('id', new ParseUUIDPipe()) id: string): Promise<Payable> {
    const row = await this.prisma.payable.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Payable ${id} not found`);
    return row;
  }
}
