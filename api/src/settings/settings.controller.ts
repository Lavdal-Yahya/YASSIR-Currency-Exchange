import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, Req } from '@nestjs/common';
import type { Settings } from '@prisma/client';
import type { Request } from 'express';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator.js';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { PERMISSIONS } from '../common/permissions.js';
import { UpdateSettingsDto } from './dto/update-settings.dto.js';
import { SettingsService } from './settings.service.js';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @RequirePermission(PERMISSIONS.SETTINGS_READ)
  @Get()
  async get(): Promise<Settings> {
    return this.settings.get();
  }

  @RequirePermission(PERMISSIONS.SETTINGS_MANAGE)
  @Patch()
  async update(
    @Body() dto: UpdateSettingsDto,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ): Promise<Settings> {
    return this.settings.update(actor.id, dto, req.ip ?? null);
  }

  @RequirePermission(PERMISSIONS.SETTINGS_GO_LIVE)
  @Post('go-live')
  @HttpCode(HttpStatus.OK)
  async goLive(@CurrentUser() actor: AuthUser, @Req() req: Request): Promise<Settings> {
    return this.settings.goLive(actor.id, req.ip ?? null);
  }
}
