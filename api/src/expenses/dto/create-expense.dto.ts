import { IsDateString, IsNotEmpty, IsOptional, IsUUID, Matches, MaxLength } from 'class-validator';
import type { MoneyString } from '../../common/money.js';

const AMOUNT_REGEX = /^\d+(\.\d{1,4})?$/;

export class CreateExpenseDto {
  @IsUUID()
  expenseCategoryId!: string;

  @IsUUID()
  currencyId!: string;

  @IsNotEmpty()
  @Matches(AMOUNT_REGEX, { message: 'amount must be a positive decimal string' })
  amount!: MoneyString;

  @IsUUID()
  paymentMethodId!: string;

  @IsOptional()
  @MaxLength(500)
  paymentMethodNote?: string;

  @IsNotEmpty()
  @MaxLength(2000)
  description!: string;

  @IsOptional()
  @IsDateString()
  transactionDate?: string;
}
