import { IsDateString, IsNotEmpty, IsUUID, Matches } from 'class-validator';
import type { MoneyString } from '../../common/money.js';

// Money on the wire is a string (D-002). Both quantity and
// openingAvgCostMru arrive as string so the browser never parses them
// into IEEE-754 numbers along the way. Regex allows an optional
// decimal portion up to 8 digits (rates use 8dp, quantity 4dp — the
// service handles per-field rounding via roundTo).
const MONEY_REGEX = /^\d+(\.\d{1,8})?$/;

export class CreateOpeningBalanceDto {
  @IsUUID()
  currencyId!: string;

  @IsNotEmpty()
  @Matches(MONEY_REGEX, { message: 'quantity must be a positive decimal string' })
  quantity!: MoneyString;

  @IsNotEmpty()
  @Matches(MONEY_REGEX, { message: 'openingAvgCostMru must be a positive decimal string' })
  openingAvgCostMru!: MoneyString;

  @IsDateString()
  effectiveDate!: string;
}
