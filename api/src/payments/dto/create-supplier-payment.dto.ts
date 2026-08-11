import { IsDateString, IsNotEmpty, IsOptional, IsUUID, Matches, MaxLength } from 'class-validator';
import type { MoneyString } from '../../common/money.js';

const AMOUNT_REGEX = /^\d+(\.\d{1,4})?$/;

export class CreateSupplierPaymentDto {
  @IsUUID()
  contactId!: string;

  @IsUUID()
  currencyId!: string;

  @IsNotEmpty()
  @Matches(AMOUNT_REGEX)
  amount!: MoneyString;

  @IsUUID()
  paymentMethodId!: string;

  @IsOptional()
  @MaxLength(500)
  paymentMethodNote?: string;

  @IsOptional()
  @MaxLength(200)
  reference?: string;

  @IsOptional()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsDateString()
  transactionDate?: string;
}
