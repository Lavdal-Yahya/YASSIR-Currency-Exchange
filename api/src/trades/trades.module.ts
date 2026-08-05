import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import { ContactTradesController } from './contact-trades.controller.js';
import { PurchaseService } from './purchase.service.js';
import { PurchasesController } from './purchases.controller.js';
import { SaleService } from './sale.service.js';
import { SalesController } from './sales.controller.js';
import { TradeReadService } from './trade-read.service.js';

// Trades module (P4). Depends on LedgerModule (every trade flows
// through LedgerService.apply — the chokepoint, architecture §3.3) and
// AuditModule (every create writes an audit row alongside the trade).
//
// Not exported: trades are a leaf module. Payments (P5) and reversal
// (P6) will read purchase/sale rows via Prisma directly rather than
// import a trade service — reversal is its own concern.

@Module({
  imports: [AuditModule, LedgerModule],
  controllers: [PurchasesController, SalesController, ContactTradesController],
  providers: [PurchaseService, SaleService, TradeReadService],
})
export class TradesModule {}
