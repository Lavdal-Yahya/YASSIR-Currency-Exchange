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
import type { Request } from 'express';
import { UsersService, type UserWithRoles } from './users.service.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { SetUserRolesDto } from './dto/set-user-roles.dto.js';
import { AuthService } from '../auth/auth.service.js';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator.js';
import { PERMISSIONS } from '../common/permissions.js';

@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly auth: AuthService,
  ) {}

  @RequirePermission(PERMISSIONS.USER_READ)
  @Get()
  async list(
    @Query('includeInactive', new ParseBoolPipe({ optional: true })) includeInactive?: boolean,
  ): Promise<UserWithRoles[]> {
    return this.users.list(includeInactive ?? false);
  }

  @RequirePermission(PERMISSIONS.USER_READ)
  @Get(':id')
  async getOne(@Param('id', new ParseUUIDPipe()) id: string): Promise<UserWithRoles> {
    return this.users.getById(id);
  }

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
  @Patch(':id')
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ): Promise<UserWithRoles> {
    return this.users.update(actor.id, id, dto, req.ip ?? null);
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

  @RequirePermission(PERMISSIONS.USER_MANAGE)
  @Post(':id/reactivate')
  @HttpCode(HttpStatus.NO_CONTENT)
  async reactivate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ): Promise<void> {
    await this.users.reactivate(actor.id, id, req.ip ?? null);
  }

  @RequirePermission(PERMISSIONS.USER_MANAGE)
  @Patch(':id/roles')
  async setRoles(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SetUserRolesDto,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ): Promise<UserWithRoles> {
    return this.users.setRoles(actor.id, id, dto.roles, req.ip ?? null);
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
