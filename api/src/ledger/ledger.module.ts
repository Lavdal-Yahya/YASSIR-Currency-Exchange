import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { BalancesController } from './balances.controller.js';
import { BalancesReadService } from './balances.read.service.js';
import { CostEngine } from './cost.engine.js';
import { LedgerController } from './ledger.controller.js';
import { LedgerReadService } from './ledger.read.service.js';
import { LedgerService } from './ledger.service.js';

// The ledger module. Exports LedgerService and CostEngine so feature
// modules (openings in P3-08, trades in P4, debts/expenses in P5) can
// inject them. Nothing else may write to currency_ledger,
// currency_balance, cost_movement, or currency_cost — every phase's
// Definition of Done greps for this (architecture §3.3).
//
// The read services (BalancesReadService, LedgerReadService) live
// here too because their queries touch the same four tables. They do
// not export — the controllers are the only surface.
@Module({
  imports: [AuditModule],
  controllers: [BalancesController, LedgerController],
  providers: [LedgerService, CostEngine, BalancesReadService, LedgerReadService],
  exports: [LedgerService, CostEngine],
})
export class LedgerModule {}
