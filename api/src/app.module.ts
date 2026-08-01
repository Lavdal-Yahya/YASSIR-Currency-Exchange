import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module.js';
import { PrismaModule } from './common/prisma.module.js';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { HealthModule } from './health/health.module.js';

// Root module. Every feature module lives inside a folder and is
// registered here. Feature modules must not import each other's
// services — cross-module needs go through a published service
// interface via a @Global module (PrismaModule, AuditModule) or,
// better, don't exist. Architecture §2.
@Module({
  imports: [AppConfigModule, PrismaModule, AuditModule, AuthModule, HealthModule],
})
export class AppModule {}
