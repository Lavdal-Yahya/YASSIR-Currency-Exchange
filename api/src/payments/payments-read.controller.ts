import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import type { Payment, Receivable, Payable } from '@prisma/client';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { PERMISSIONS } from '../common/permissions.js';
import { PrismaService } from '../common/prisma.service.js';
import type { Paginated } from '../trades/trade-read.service.js';
import { ListDebtsQueryDto, ListPaymentsQueryDto } from './dto/list-debts.dto.js';

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
