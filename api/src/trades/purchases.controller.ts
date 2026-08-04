import { Body, Controller, Headers, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator.js';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { PERMISSIONS } from '../common/permissions.js';
import { CreatePurchaseDto } from './dto/create-purchase.dto.js';
import { PurchaseService } from './purchase.service.js';

// Purchases controller — only the P4-A slice: POST /purchases. The
// list / detail / filter endpoints (GET /purchases[, /:id]) land in
// PR-B alongside the frontend forms, so the DTO and permission set
// only need to cover create for now.

@Controller('purchases')
export class PurchasesController {
  constructor(private readonly purchases: PurchaseService) {}

  @RequirePermission(PERMISSIONS.PURCHASE_CREATE)
  @Post()
  async create(
    @Body() dto: CreatePurchaseDto,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
    // Header falls through to DTO — the frontend sends `Idempotency-Key`
    // but the DTO's field is `idempotencyKey`. Copy from header to body
    // so the service sees a consistent shape whether the caller uses
    // the header (recommended) or an explicit field (tests).
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    if (idempotencyKey && !dto.idempotencyKey) {
      dto.idempotencyKey = idempotencyKey;
    }
    return this.purchases.create(actor.id, dto, req.ip ?? null);
  }
}
