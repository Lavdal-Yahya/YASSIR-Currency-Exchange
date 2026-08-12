import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service.js';
import { AuditViewerController } from './audit-viewer.controller.js';
import { AuditViewerService } from './audit-viewer.service.js';

@Global()
@Module({
  controllers: [AuditViewerController],
  providers: [AuditService, AuditViewerService],
  exports: [AuditService],
})
export class AuditModule {}
