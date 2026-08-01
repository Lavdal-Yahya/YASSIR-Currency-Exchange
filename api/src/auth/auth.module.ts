import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtStrategy } from './jwt.strategy.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { PermissionGuard } from './permission.guard.js';
import { LoginThrottlerGuard } from './login-throttler.guard.js';
import type { Env } from '../config/env.schema.js';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
        signOptions: { expiresIn: config.get('JWT_TTL', { infer: true }) },
      }),
    }),
    // Two throttlers on POST /auth/login (P1-06):
    //   ip    — 5 attempts / minute / IP
    //   phone — 10 attempts / hour / phone number (custom getTracker)
    ThrottlerModule.forRoot([
      { name: 'ip', ttl: 60_000, limit: 5 },
      { name: 'phone', ttl: 3_600_000, limit: 10 },
    ]),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    LoginThrottlerGuard,
    // Global chain, evaluated in declaration order.
    //   1. JwtAuthGuard      — populates req.user (or 401)
    //   2. PermissionGuard   — enforces @RequirePermission
    // A route with neither @Public nor @RequirePermission fails closed
    // at PermissionGuard; the route-table test asserts that no such
    // route exists by construction.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
