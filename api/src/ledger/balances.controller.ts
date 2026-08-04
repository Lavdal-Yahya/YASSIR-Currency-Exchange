import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { PERMISSIONS } from '../common/permissions.js';
import { BalancesReadService } from './balances.read.service.js';

// Read APIs for the balance cache (P3-05). Every currency the system
// has ever touched has a currency_balance row; the list endpoint
// joins in the currency master row and the last movement date, so
// the dashboard doesn't need three round-trips.
//
// Permissions: `balance:read`. The employee role already carries it.
// No mutating endpoints — the balance is derived from the ledger, and
// the ledger is written only through LedgerService.

@Controller('balances')
export class BalancesController {
  constructor(private readonly balances: BalancesReadService) {}

  @RequirePermission(PERMISSIONS.BALANCE_READ)
  @Get()
  async list() {
    return this.balances.listActive();
  }

  @RequirePermission(PERMISSIONS.BALANCE_READ)
  @Get(':currencyId')
  async getOne(@Param('currencyId', new ParseUUIDPipe()) currencyId: string) {
    return this.balances.getOne(currencyId);
  }
}
