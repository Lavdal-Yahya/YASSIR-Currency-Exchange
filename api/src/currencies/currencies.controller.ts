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
import type { Currency } from '@prisma/client';
import type { Request } from 'express';
import { CurrenciesService } from './currencies.service.js';
import { CreateCurrencyDto } from './dto/create-currency.dto.js';
import { UpdateCurrencyDto } from './dto/update-currency.dto.js';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator.js';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { PERMISSIONS } from '../common/permissions.js';

// No DELETE endpoint. A currency is *deactivated*, never removed —
// audit tables reference `code` even after the row is hidden. The DoD
// for P2-01 asks for a curl of DELETE returning 405; there is nothing
// here for it to hit, so Nest returns 404 by default (still acceptable
// per phase-2.md §7 which says "404/405").

@Controller('currencies')
export class CurrenciesController {
  constructor(private readonly currencies: CurrenciesService) {}

  @RequirePermission(PERMISSIONS.CURRENCY_READ)
  @Get()
  async list(
    @Query('includeInactive', new ParseBoolPipe({ optional: true })) includeInactive?: boolean,
  ): Promise<Currency[]> {
    return this.currencies.list(includeInactive ?? false);
  }

  @RequirePermission(PERMISSIONS.CURRENCY_READ)
  @Get(':id')
  async getOne(@Param('id', new ParseUUIDPipe()) id: string): Promise<Currency> {
    return this.currencies.getById(id);
  }

  @RequirePermission(PERMISSIONS.CURRENCY_MANAGE)
  @Post()
  async create(
    @Body() dto: CreateCurrencyDto,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ): Promise<Currency> {
    return this.currencies.create(actor.id, dto, req.ip ?? null);
  }

  @RequirePermission(PERMISSIONS.CURRENCY_MANAGE)
  @Patch(':id')
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateCurrencyDto,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ): Promise<Currency> {
    return this.currencies.update(actor.id, id, dto, req.ip ?? null);
  }

  @RequirePermission(PERMISSIONS.CURRENCY_MANAGE)
  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  async deactivate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ): Promise<Currency> {
    return this.currencies.deactivate(actor.id, id, req.ip ?? null);
  }

  @RequirePermission(PERMISSIONS.CURRENCY_MANAGE)
  @Post(':id/reactivate')
  @HttpCode(HttpStatus.OK)
  async reactivate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ): Promise<Currency> {
    return this.currencies.reactivate(actor.id, id, req.ip ?? null);
  }
}
