import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import { OpeningBalanceService } from './opening-balance.service.js';
import { OpeningDebtService } from './opening-debt.service.js';
import { OpeningsController } from './openings.controller.js';

// Openings module. Depends on LedgerModule (opening balances flow
// through LedgerService.apply) and AuditModule (every opening writes
// an audit row alongside the ledger row).
//
// Not exported — openings are a leaf module. If P4 or P5 ever needs
// to talk to them it'll be for reversal, which reads not writes.
@Module({
  imports: [AuditModule, LedgerModule],
  controllers: [OpeningsController],
  providers: [OpeningBalanceService, OpeningDebtService],
})
export class OpeningsModule {}
