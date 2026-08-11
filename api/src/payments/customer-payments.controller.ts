import { Body, Controller, Post, Req } from '@nestjs/common';
import type { Payment } from '@prisma/client';
import type { Request } from 'express';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator.js';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { PERMISSIONS } from '../common/permissions.js';
import { CustomerPaymentService } from './customer-payment.service.js';
import { CreateCustomerPaymentDto } from './dto/create-customer-payment.dto.js';

@Controller('customer-payments')
export class CustomerPaymentsController {
  constructor(private readonly service: CustomerPaymentService) {}

  @RequirePermission(PERMISSIONS.PAYMENT_RECEIVE)
  @Post()
  async create(
    @Body() dto: CreateCustomerPaymentDto,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ): Promise<Payment> {
    return this.service.create(actor.id, dto, req.ip ?? null);
  }
}
