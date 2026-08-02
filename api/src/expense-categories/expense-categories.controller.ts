import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseBoolPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { ExpenseCategory } from '@prisma/client';
import type { Request } from 'express';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator.js';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { PERMISSIONS } from '../common/permissions.js';
import { CreateExpenseCategoryDto } from './dto/create-expense-category.dto.js';
import { UpdateExpenseCategoryDto } from './dto/update-expense-category.dto.js';
import { ExpenseCategoriesService } from './expense-categories.service.js';

@Controller('expense-categories')
export class ExpenseCategoriesController {
  constructor(private readonly categories: ExpenseCategoriesService) {}

  @RequirePermission(PERMISSIONS.EXPENSE_CATEGORY_READ)
  @Get()
  async list(
    @Query('includeInactive', new ParseBoolPipe({ optional: true })) includeInactive?: boolean,
  ): Promise<ExpenseCategory[]> {
    return this.categories.list(includeInactive ?? false);
  }

  @RequirePermission(PERMISSIONS.EXPENSE_CATEGORY_READ)
  @Get(':id')
  async getOne(@Param('id', new ParseUUIDPipe()) id: string): Promise<ExpenseCategory> {
    return this.categories.getById(id);
  }

  @RequirePermission(PERMISSIONS.EXPENSE_CATEGORY_MANAGE)
  @Post()
  async create(
    @Body() dto: CreateExpenseCategoryDto,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ): Promise<ExpenseCategory> {
    return this.categories.create(actor.id, dto, req.ip ?? null);
  }

  @RequirePermission(PERMISSIONS.EXPENSE_CATEGORY_MANAGE)
  @Patch(':id')
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateExpenseCategoryDto,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ): Promise<ExpenseCategory> {
    return this.categories.update(actor.id, id, dto, req.ip ?? null);
  }

  @RequirePermission(PERMISSIONS.EXPENSE_CATEGORY_MANAGE)
  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  async deactivate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ): Promise<ExpenseCategory> {
    return this.categories.deactivate(actor.id, id, req.ip ?? null);
  }

  @RequirePermission(PERMISSIONS.EXPENSE_CATEGORY_MANAGE)
  @Post(':id/reactivate')
  @HttpCode(HttpStatus.OK)
  async reactivate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ): Promise<ExpenseCategory> {
    return this.categories.reactivate(actor.id, id, req.ip ?? null);
  }
}
