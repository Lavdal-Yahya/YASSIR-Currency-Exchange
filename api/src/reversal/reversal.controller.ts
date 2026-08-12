import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator.js';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { PERMISSIONS } from '../common/permissions.js';
import { ReverseDto } from './dto/reverse.dto.js';
import { ExpenseReversalService } from './expense-reversal.service.js';
import { PaymentReversalService } from './payment-reversal.service.js';
import { TradeReversalService, type TradeReversalResult } from './trade-reversal.service.js';

// P6 reversal endpoints — one per reversible source type.
//
// Permission split (P6-05):
//   · trades   → reversal:trade  (recompute-and-restate is high-blast-radius)
//   · payments → reversal:payment
//   · expenses → reversal:expense
//
// Owner has all three by default; the split lets the operator delegate
// payment/expense reversals to a manager without also handing out trade
// reversal. All three are outside the EMPLOYEE role.
//
// Every endpoint returns 200 with the updated row (plus, for trades,
// the count/IDs of restated sales). No 204 — the response body is what
// the frontend uses to render the "N sales restated" toast.

@Controller()
export class ReversalController {
  constructor(
    private readonly trades: TradeReversalService,
    private readonly payments: PaymentReversalService,
    private readonly expenses: ExpenseReversalService,
  ) {}

  @RequirePermission(PERMISSIONS.REVERSAL_TRADE)
  @Post('purchases/:id/reverse')
  @HttpCode(HttpStatus.OK)
  async reversePurchase(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReverseDto,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ): Promise<TradeReversalResult> {
    return this.trades.reversePurchase(id, actor.id, dto.reason, req.ip ?? null);
  }

  @RequirePermission(PERMISSIONS.REVERSAL_TRADE)
  @Post('sales/:id/reverse')
  @HttpCode(HttpStatus.OK)
  async reverseSale(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReverseDto,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ): Promise<TradeReversalResult> {
    return this.trades.reverseSale(id, actor.id, dto.reason, req.ip ?? null);
  }

  @RequirePermission(PERMISSIONS.REVERSAL_PAYMENT)
  @Post('payments/:id/reverse')
  @HttpCode(HttpStatus.OK)
  async reversePayment(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReverseDto,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ) {
    return this.payments.reverse(id, actor.id, dto.reason, req.ip ?? null);
  }

  @RequirePermission(PERMISSIONS.REVERSAL_EXPENSE)
  @Post('expenses/:id/reverse')
  @HttpCode(HttpStatus.OK)
  async reverseExpense(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReverseDto,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ) {
    return this.expenses.reverse(id, actor.id, dto.reason, req.ip ?? null);
  }
}
