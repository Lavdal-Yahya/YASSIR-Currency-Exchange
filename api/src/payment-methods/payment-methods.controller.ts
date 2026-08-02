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
import type { PaymentMethod } from '@prisma/client';
import type { Request } from 'express';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator.js';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { PERMISSIONS } from '../common/permissions.js';
import { CreatePaymentMethodDto } from './dto/create-payment-method.dto.js';
import { UpdatePaymentMethodDto } from './dto/update-payment-method.dto.js';
import { PaymentMethodsService } from './payment-methods.service.js';

@Controller('payment-methods')
export class PaymentMethodsController {
  constructor(private readonly methods: PaymentMethodsService) {}

  @RequirePermission(PERMISSIONS.PAYMENT_METHOD_READ)
  @Get()
  async list(
    @Query('includeInactive', new ParseBoolPipe({ optional: true })) includeInactive?: boolean,
  ): Promise<PaymentMethod[]> {
    return this.methods.list(includeInactive ?? false);
  }

  @RequirePermission(PERMISSIONS.PAYMENT_METHOD_READ)
  @Get(':id')
  async getOne(@Param('id', new ParseUUIDPipe()) id: string): Promise<PaymentMethod> {
    return this.methods.getById(id);
  }

  @RequirePermission(PERMISSIONS.PAYMENT_METHOD_MANAGE)
  @Post()
  async create(
    @Body() dto: CreatePaymentMethodDto,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ): Promise<PaymentMethod> {
    return this.methods.create(actor.id, dto, req.ip ?? null);
  }

  @RequirePermission(PERMISSIONS.PAYMENT_METHOD_MANAGE)
  @Patch(':id')
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdatePaymentMethodDto,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ): Promise<PaymentMethod> {
    return this.methods.update(actor.id, id, dto, req.ip ?? null);
  }

  @RequirePermission(PERMISSIONS.PAYMENT_METHOD_MANAGE)
  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  async deactivate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ): Promise<PaymentMethod> {
    return this.methods.deactivate(actor.id, id, req.ip ?? null);
  }

  @RequirePermission(PERMISSIONS.PAYMENT_METHOD_MANAGE)
  @Post(':id/reactivate')
  @HttpCode(HttpStatus.OK)
  async reactivate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ): Promise<PaymentMethod> {
    return this.methods.reactivate(actor.id, id, req.ip ?? null);
  }
}
