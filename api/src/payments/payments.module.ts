import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import { CustomerPaymentsController } from './customer-payments.controller.js';
import { CustomerPaymentService } from './customer-payment.service.js';
import { SupplierPaymentsController } from './supplier-payments.controller.js';
import { SupplierPaymentService } from './supplier-payment.service.js';
import { PaymentsReadController } from './payments-read.controller.js';
import { RecomputeService } from './recompute.service.js';

@Module({
  imports: [AuditModule, LedgerModule],
  controllers: [CustomerPaymentsController, SupplierPaymentsController, PaymentsReadController],
  providers: [CustomerPaymentService, SupplierPaymentService, RecomputeService],
  exports: [RecomputeService],
})
export class PaymentsModule {}
