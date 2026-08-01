import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

// Single Prisma client for the whole process. Services accept the
// transaction client (`tx`) as their first parameter — architecture §3.3 —
// so this is only used to *open* transactions and for read paths.
//
// Never call `this.prisma.$disconnect()` inside a service method.
// Lifecycle is Nest-managed via OnModuleDestroy.

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Prisma connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
