import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service.js';
import { Public } from '../common/decorators/public.decorator.js';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async check(): Promise<{ status: 'ok' | 'degraded'; version: string; dbUp: boolean }> {
    let dbUp = false;
    try {
      await this.prisma.$queryRawUnsafe('SELECT 1');
      dbUp = true;
    } catch {
      dbUp = false;
    }
    return {
      status: dbUp ? 'ok' : 'degraded',
      version: process.env.APP_VERSION ?? 'dev',
      dbUp,
    };
  }
}
