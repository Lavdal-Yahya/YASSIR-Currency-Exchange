import { IsIn, IsNotEmpty, IsUUID, Matches } from 'class-validator';
import type { MoneyString } from '../../common/money.js';

const MONEY_REGEX = /^\d+(\.\d{1,4})?$/;

export class CreateOpeningDebtDto {
  @IsUUID()
  contactId!: string;

  @IsUUID()
  currencyId!: string;

  @IsNotEmpty()
  @Matches(MONEY_REGEX, { message: 'amount must be a positive decimal string' })
  amount!: MoneyString;

  // Debt side. UI has two forms; the server accepts one endpoint with
  // an explicit side so a stray toggle can't create the wrong shape.
  @IsIn(['receivable', 'payable'])
  side!: 'receivable' | 'payable';
}
