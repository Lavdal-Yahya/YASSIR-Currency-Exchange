import { Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Query } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator.js';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { PERMISSIONS } from '../common/permissions.js';
import { TradeReadService, type ContactTradeItem, type Paginated } from './trade-read.service.js';

// GET /contacts/:id/trades — unified trade timeline for a contact.
//
// Requires contact:read (the primary gate for any contact resource).
// Profit fields on sale items are stripped via mapSaleResponse when the
// caller lacks profit:view (D-018) — same rule as GET /sales.
//
// The route path prefix "contacts" matches the ContactsController prefix
// without conflict: Express does not match /contacts/:id against
// /contacts/:id/trades (different segment count).

@Controller('contacts')
export class ContactTradesController {
  constructor(private readonly reads: TradeReadService) {}

  @RequirePermission(PERMISSIONS.CONTACT_READ)
  @Get(':contactId/trades')
  async getTrades(
    @Param('contactId', new ParseUUIDPipe()) contactId: string,
    @CurrentUser() actor: AuthUser,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
  ): Promise<Paginated<ContactTradeItem>> {
    const hasProfitView = actor.permissions?.has(PERMISSIONS.PROFIT_VIEW) ?? false;
    return this.reads.listContactTrades(contactId, hasProfitView, limit ?? 50, offset ?? 0);
  }
}
