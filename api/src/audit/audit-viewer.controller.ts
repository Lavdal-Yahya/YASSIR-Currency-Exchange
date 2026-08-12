import { Controller, Get, Query } from '@nestjs/common';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { PERMISSIONS } from '../common/permissions.js';
import type { Paginated } from '../trades/trade-read.service.js';
import { AuditViewerService, type AuditLogRow } from './audit-viewer.service.js';
import { ListAuditQueryDto } from './dto/list-audit.dto.js';

@Controller('audit-log')
export class AuditViewerController {
  constructor(private readonly svc: AuditViewerService) {}

  @RequirePermission(PERMISSIONS.AUDIT_READ)
  @Get()
  async list(@Query() query: ListAuditQueryDto): Promise<Paginated<AuditLogRow>> {
    return this.svc.list(query);
  }
}
