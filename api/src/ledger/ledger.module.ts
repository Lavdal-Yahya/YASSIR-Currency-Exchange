import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { CostEngine } from './cost.engine.js';
import { LedgerService } from './ledger.service.js';

// The ledger module. Exports LedgerService and CostEngine so feature
// modules (openings in P3-08, trades in P4, debts/expenses in P5) can
// inject them. Nothing else may write to currency_ledger,
// currency_balance, cost_movement, or currency_cost — every phase's
// Definition of Done greps for this (architecture §3.3).
@Module({
  imports: [AuditModule],
  providers: [LedgerService, CostEngine],
  exports: [LedgerService, CostEngine],
})
export class LedgerModule {}
