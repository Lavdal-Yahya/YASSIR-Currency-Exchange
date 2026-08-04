import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator.js';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { PERMISSIONS } from '../common/permissions.js';
import { CreateOpeningBalanceDto } from './dto/create-opening-balance.dto.js';
import { CreateOpeningDebtDto } from './dto/create-opening-debt.dto.js';
import { UpdateOpeningBalanceDto } from './dto/update-opening-balance.dto.js';
import { OpeningBalanceService } from './opening-balance.service.js';
import { OpeningDebtService } from './opening-debt.service.js';

// Endpoints per docs/phases/phase-3.md §4:
//   GET   /openings
//   POST  /openings/currency
//   POST  /openings/debt
//   PATCH /openings/currency/:id   ← locked after go-live unless
//                                    caller has opening:adjust_post_golive
//
// The go-live lock on POST is inside the service (assertPreGoLive) —
// having it there guarantees the shell-of-a-transaction never opens
// for a refused write. The PATCH lock is here because it depends on
// a permission the service doesn't know about.

@Controller('openings')
export class OpeningsController {
  constructor(
    private readonly balances: OpeningBalanceService,
    private readonly debts: OpeningDebtService,
  ) {}

  @RequirePermission(PERMISSIONS.OPENING_READ)
  @Get()
  async list() {
    const [balances, debts, isPostGoLive] = await Promise.all([
      this.balances.list(),
      this.debts.list(),
      this.balances.isPostGoLive(),
    ]);
    return { balances, debts, isPostGoLive };
  }

  @RequirePermission(PERMISSIONS.OPENING_READ)
  @Get('currency/:id')
  async getOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.balances.getById(id);
  }

  @RequirePermission(PERMISSIONS.OPENING_MANAGE)
  @Post('currency')
  async createBalance(
    @Body() dto: CreateOpeningBalanceDto,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ) {
    return this.balances.create(actor.id, dto, req.ip ?? null);
  }

  @RequirePermission(PERMISSIONS.OPENING_MANAGE)
  @Post('debt')
  async createDebt(
    @Body() dto: CreateOpeningDebtDto,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ) {
    return this.debts.create(actor.id, dto, req.ip ?? null);
  }

  @RequirePermission(PERMISSIONS.OPENING_MANAGE)
  @Patch('currency/:id')
  async updateBalance(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateOpeningBalanceDto,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ) {
    // Post-go-live PATCH is refused for callers without the adjust
    // permission (P3-10). Nest doesn't have an easy way to make
    // @RequirePermission choose between two perms depending on system
    // state, so the check happens here in-controller.
    const postGoLive = await this.balances.isPostGoLive();
    if (postGoLive && !actor.permissions?.has(PERMISSIONS.OPENING_ADJUST_POST_GOLIVE)) {
      throw new ForbiddenException({
        code: 'opening_after_go_live',
        i18nKey: 'error.opening_after_go_live',
      });
    }
    return this.balances.update(actor.id, id, dto, req.ip ?? null);
  }
}
