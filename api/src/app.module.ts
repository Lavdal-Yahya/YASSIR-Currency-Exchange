import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { AppConfigModule } from './config/config.module.js';
import { PrismaModule } from './common/prisma.module.js';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { CurrenciesModule } from './currencies/currencies.module.js';
import { HealthModule } from './health/health.module.js';

// Root module. Every feature module lives inside a folder and is
// registered here. Feature modules must not import each other's
// services — cross-module needs go through a published service
// interface via a @Global module (PrismaModule, AuditModule) or,
// better, don't exist. Architecture §2.
@Module({
  imports: [
    // DiscoveryModule powers the route-table introspection test (P1-07)
    // which walks every controller and asserts each handler has one of
    // @Public / @Authenticated / @RequirePermission. Zero runtime cost
    // in production; keeping it imported keeps the guarantee available.
    DiscoveryModule,
    AppConfigModule,
    PrismaModule,
    AuditModule,
    AuthModule,
    UsersModule,
    CurrenciesModule,
    HealthModule,
  ],
})
export class AppModule {}
