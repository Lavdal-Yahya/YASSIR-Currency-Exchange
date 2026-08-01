import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { UsersService } from './users.service.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { AuthService } from '../auth/auth.service.js';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator.js';
import { PERMISSIONS } from '../common/permissions.js';

// Minimal user management surface in P1. P2-06 adds list, edit, and the
// permission matrix. The routes here exist because the P1 DoD asks that
// `curl POST /api/v1/users` without permission returns 403 (proven over
// HTTP, not a hidden button).

@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly auth: AuthService,
  ) {}

  @RequirePermission(PERMISSIONS.USER_CREATE)
  @Post()
  async create(
    @Body() dto: CreateUserDto,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ): Promise<{ id: string; phone: string }> {
    return this.users.create({
      phone: dto.phone,
      pin: dto.pin,
      fullName: dto.fullName,
      roles: dto.roles ?? [],
      isActive: dto.isActive ?? true,
      actorUserId: actor.id,
      ip: req.ip ?? null,
    });
  }

  @RequirePermission(PERMISSIONS.USER_MANAGE)
  @Post(':id/deactivate')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deactivate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ): Promise<void> {
    await this.users.deactivate(actor.id, id, req.ip ?? null);
  }

  @RequirePermission(PERMISSIONS.USER_RESET_PIN)
  @Post(':id/reset-pin')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPin(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body('pin') pin: string,
    @CurrentUser() actor: AuthUser,
  ): Promise<void> {
    await this.auth.resetPin(actor.id, id, pin);
  }
}
