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
import type { Purchase } from '@prisma/client';
import type { Request } from 'express';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator.js';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { PERMISSIONS } from '../common/permissions.js';
import { ListTradesQueryDto } from './dto/list-trades.dto.js';
import { CreatePurchaseDto } from './dto/create-purchase.dto.js';
import { PurchaseService } from './purchase.service.js';
import { TradeReadService, type Paginated } from './trade-read.service.js';

@Controller('purchases')
export class PurchasesController {
  constructor(
    private readonly purchases: PurchaseService,
    private readonly reads: TradeReadService,
  ) {}

  @RequirePermission(PERMISSIONS.PURCHASE_READ)
  @Get()
  async list(@Query() query: ListTradesQueryDto): Promise<Paginated<Purchase>> {
    return this.reads.listPurchases(query);
  }

  @RequirePermission(PERMISSIONS.PURCHASE_READ)
  @Get(':id')
  async getOne(@Param('id', new ParseUUIDPipe()) id: string): Promise<Purchase> {
    return this.reads.getPurchase(id);
  }

  @RequirePermission(PERMISSIONS.PURCHASE_CREATE)
  @Post()
  async create(
    @Body() dto: CreatePurchaseDto,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    if (idempotencyKey && !dto.idempotencyKey) {
      dto.idempotencyKey = idempotencyKey;
    }
    return this.purchases.create(actor.id, dto, req.ip ?? null);
  }
}
