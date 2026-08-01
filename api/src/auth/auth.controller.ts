import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { Public } from '../common/decorators/public.decorator.js';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator.js';
import type { Env } from '../config/env.schema.js';

function parseTtlMs(spec: string): number {
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(spec);
  if (!match) throw new Error(`invalid duration: ${spec}`);
  const value = Number.parseInt(match[1] ?? '0', 10);
  const unit = match[2] as 'ms' | 's' | 'm' | 'h' | 'd';
  const table = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;
  return value * table[unit];
}

@Controller('auth')
export class AuthController {
  private readonly cookieName: string;
  private readonly cookieMaxAge: number;
  private readonly isProduction: boolean;

  constructor(
    private readonly auth: AuthService,
    config: ConfigService<Env, true>,
  ) {
    this.cookieName = config.get('COOKIE_NAME', { infer: true });
    this.cookieMaxAge = parseTtlMs(config.get('JWT_TTL', { infer: true }));
    this.isProduction = config.get('NODE_ENV', { infer: true }) === 'production';
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.NO_CONTENT)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const ip = req.ip ?? null;
    const result = await this.auth.login(dto.phone, dto.pin, ip);
    res.cookie(this.cookieName, result.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.isProduction,
      maxAge: this.cookieMaxAge,
      path: '/',
    });
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(user.id, req.ip ?? null);
    res.clearCookie(this.cookieName, { path: '/' });
  }

  @Get('me')
  async me(@CurrentUser() user: AuthUser): Promise<{
    id: string;
    phone: string;
    fullName: string;
    roles: string[];
    permissions: string[];
  }> {
    const found = await this.auth.getUserWithRolesAndPermissions(user.id);
    if (!found) throw new UnauthorizedException();
    return found;
  }
}
