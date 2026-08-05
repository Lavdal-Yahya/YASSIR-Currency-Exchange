import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator.js';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { PERMISSIONS } from '../common/permissions.js';
import { ListTradesQueryDto } from './dto/list-trades.dto.js';
import { CreateSaleDto } from './dto/create-sale.dto.js';
import { SaleService } from './sale.service.js';
import { TradeReadService, type Paginated } from './trade-read.service.js';
import { mapSaleResponse, type SaleResponse } from './trade-common.js';

// D-018: profit fields (grossProfitMru, costOfCurrencySoldMru) are stripped
// via mapSaleResponse on ALL responses — POST and GET alike — when the caller
// lacks profit:view. The permission is enforced at the serializer here, not
// just a route guard, so there is no path that leaks the fields to employees.

@Controller('sales')
export class SalesController {
  constructor(
    private readonly sales: SaleService,
    private readonly reads: TradeReadService,
  ) {}

  @RequirePermission(PERMISSIONS.SALE_READ)
  @Get()
  async list(
    @Query() query: ListTradesQueryDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<Paginated<SaleResponse>> {
    const hasProfitView = actor.permissions?.has(PERMISSIONS.PROFIT_VIEW) ?? false;
    return this.reads.listSales(query, hasProfitView);
  }

  @RequirePermission(PERMISSIONS.SALE_READ)
  @Get(':id')
  async getOne(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthUser,
  ): Promise<SaleResponse> {
    const hasProfitView = actor.permissions?.has(PERMISSIONS.PROFIT_VIEW) ?? false;
    return this.reads.getSale(id, hasProfitView);
  }

  @RequirePermission(PERMISSIONS.SALE_CREATE)
  @Post()
  async create(
    @Body() dto: CreateSaleDto,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<SaleResponse> {
    if (idempotencyKey && !dto.idempotencyKey) {
      dto.idempotencyKey = idempotencyKey;
    }
    const sale = await this.sales.create(actor.id, dto, req.ip ?? null);
    const hasProfitView = actor.permissions?.has(PERMISSIONS.PROFIT_VIEW) ?? false;
    return mapSaleResponse(sale, hasProfitView);
  }
}
