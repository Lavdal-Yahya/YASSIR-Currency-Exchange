import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import { CustomerPaymentsController } from './customer-payments.controller.js';
import { CustomerPaymentService } from './customer-payment.service.js';
import { PaymentsReadController } from './payments-read.controller.js';
import { RecomputeService } from './recompute.service.js';

@Module({
  imports: [AuditModule, LedgerModule],
  controllers: [CustomerPaymentsController, PaymentsReadController],
  providers: [CustomerPaymentService, RecomputeService],
  exports: [RecomputeService],
})
export class PaymentsModule {}
