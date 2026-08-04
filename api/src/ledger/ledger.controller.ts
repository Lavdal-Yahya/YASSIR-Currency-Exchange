import { Controller, Get, Query } from '@nestjs/common';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { PERMISSIONS } from '../common/permissions.js';
import { ListLedgerQueryDto } from './dto/list-ledger.dto.js';
import { LedgerReadService } from './ledger.read.service.js';

// Read APIs for the append-only ledger (P3-05). Paginated server-side
// (spec §41 — never send a full history to the browser). Filters
// mirror the spec §24 set: currency + date range.
//
// Permission: `ledger:read`. The employee role holds it — a till
// operator can inspect the ledger for their own reconciliation.
// includeInactive flips only for callers who also have `audit:read`
// (P6-06), enforced in the service.

@Controller('ledger')
export class LedgerController {
  constructor(private readonly ledger: LedgerReadService) {}

  @RequirePermission(PERMISSIONS.LEDGER_READ)
  @Get()
  async list(@Query() q: ListLedgerQueryDto) {
    return this.ledger.list({
      currencyId: q.currencyId,
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
      includeInactive: q.includeInactive === 'true',
      limit: q.limit ?? 50,
      offset: q.offset ?? 0,
    });
  }
}
