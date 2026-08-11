import { IsDateString, IsNotEmpty, IsOptional, IsUUID, Matches, MaxLength } from 'class-validator';
import type { MoneyString } from '../../common/money.js';

const AMOUNT_REGEX = /^\d+(\.\d{1,4})?$/;
const RATE_REGEX = /^\d+(\.\d{1,8})?$/;

export class CreateCustomerPaymentDto {
  @IsUUID()
  contactId!: string;

  /** Currency the customer is paying in — must match the receivable currency (spec §15.2). */
  @IsUUID()
  currencyId!: string;

  @IsNotEmpty()
  @Matches(AMOUNT_REGEX, { message: 'amount must be a positive decimal string' })
  amount!: MoneyString;

  /** D-020: always required for a cash movement. */
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

  /**
   * Required when currencyId is a non-base currency (LedgerService needs
   * the MRU unit cost for the WAC book). Omit for MRU payments.
   */
  @IsOptional()
  @Matches(RATE_REGEX, { message: 'unitCostMru must be a positive decimal string' })
  unitCostMru?: MoneyString;
}
