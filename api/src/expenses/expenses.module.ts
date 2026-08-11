import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import { ExpensesController } from './expenses.controller.js';
import { ExpenseService } from './expense.service.js';

@Module({
  imports: [AuditModule, LedgerModule],
  controllers: [ExpensesController],
  providers: [ExpenseService],
})
export class ExpensesModule {}
