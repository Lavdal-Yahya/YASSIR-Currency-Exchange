import { Body, Controller, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { Payment } from '@prisma/client';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator.js';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { PERMISSIONS } from '../common/permissions.js';
import { CreateSupplierPaymentDto } from './dto/create-supplier-payment.dto.js';
import { SupplierPaymentService } from './supplier-payment.service.js';

@Controller('supplier-payments')
export class SupplierPaymentsController {
  constructor(private readonly svc: SupplierPaymentService) {}

  @RequirePermission(PERMISSIONS.PAYMENT_PAY)
  @Post()
  async create(
    @Body() dto: CreateSupplierPaymentDto,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ): Promise<Payment> {
    return this.svc.create(actor.id, dto, req.ip ?? null);
  }
}
