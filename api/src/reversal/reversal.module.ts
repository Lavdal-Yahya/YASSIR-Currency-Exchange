import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { ExpenseReversalService } from './expense-reversal.service.js';
import { PaymentReversalService } from './payment-reversal.service.js';
import { ReversalController } from './reversal.controller.js';
import { TradeReversalService } from './trade-reversal.service.js';

// PaymentsModule is imported to reuse RecomputeService for the
// payment-reversal recompute of affected receivables/payables.
@Module({
  imports: [LedgerModule, PaymentsModule],
  controllers: [ReversalController],
  providers: [PaymentReversalService, ExpenseReversalService, TradeReversalService],
})
export class ReversalModule {}
