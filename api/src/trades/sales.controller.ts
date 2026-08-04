import { Body, Controller, Headers, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator.js';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { PERMISSIONS } from '../common/permissions.js';
import { CreateSaleDto } from './dto/create-sale.dto.js';
import { SaleService } from './sale.service.js';

// Sales controller — POST /sales for PR-A. GET endpoints land in PR-B
// along with the frontend list/detail pages. D-018 profit-view stripping
// is applied in the serializer (added when GET lands); the create
// response returns the raw sale row here, which includes the profit
// fields — this endpoint requires PURCHASE_CREATE-tier permission and
// the operator who creates a sale is trusted with what they just booked.

@Controller('sales')
export class SalesController {
  constructor(private readonly sales: SaleService) {}

  @RequirePermission(PERMISSIONS.SALE_CREATE)
  @Post()
  async create(
    @Body() dto: CreateSaleDto,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    if (idempotencyKey && !dto.idempotencyKey) {
      dto.idempotencyKey = idempotencyKey;
    }
    return this.sales.create(actor.id, dto, req.ip ?? null);
  }
}
