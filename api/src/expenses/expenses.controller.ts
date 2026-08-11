import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Expense } from '@prisma/client';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator.js';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { PERMISSIONS } from '../common/permissions.js';
import { PrismaService } from '../common/prisma.service.js';
import type { Paginated } from '../trades/trade-read.service.js';
import { CreateExpenseDto } from './dto/create-expense.dto.js';
import { ListExpensesQueryDto } from './dto/list-expenses.dto.js';
import { ExpenseService } from './expense.service.js';

@Controller('expenses')
export class ExpensesController {
  constructor(
    private readonly svc: ExpenseService,
    private readonly prisma: PrismaService,
  ) {}

  @RequirePermission(PERMISSIONS.EXPENSE_CREATE)
  @Post()
  async create(
    @Body() dto: CreateExpenseDto,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ): Promise<Expense> {
    return this.svc.create(actor.id, dto, req.ip ?? null);
  }

  @RequirePermission(PERMISSIONS.EXPENSE_READ)
  @Get()
  async list(@Query() query: ListExpensesQueryDto): Promise<Paginated<Expense>> {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    const where = {
      ...(query.expenseCategoryId ? { expenseCategoryId: query.expenseCategoryId } : {}),
      ...(query.currencyId ? { currencyId: query.currencyId } : {}),
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
      this.prisma.expense.findMany({
        where,
        orderBy: { transactionDate: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.expense.count({ where }),
    ]);
    return { data, total };
  }

  @RequirePermission(PERMISSIONS.EXPENSE_READ)
  @Get(':id')
  async getById(@Param('id', new ParseUUIDPipe()) id: string): Promise<Expense> {
    const row = await this.prisma.expense.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Expense ${id} not found`);
    return row;
  }
}
