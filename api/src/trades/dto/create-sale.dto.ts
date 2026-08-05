import { IsDateString, IsNotEmpty, IsOptional, IsUUID, Matches, MaxLength } from 'class-validator';
import type { MoneyString } from '../../common/money.js';

// Near-mirror of CreatePurchaseDto — the two are kept as separate
// classes so class-validator's decorator-based validation stays
// straightforward and each side can grow additional fields (see
// recipient_name / destination on Sale, spec §12.2) without
// contaminating the other.

const AMOUNT_REGEX = /^\d+(\.\d{1,4})?$/;
const RATE_REGEX = /^\d+(\.\d{1,8})?$/;

export class CreateSaleDto {
  @IsOptional()
  @IsUUID()
  contactId?: string;

  @IsUUID()
  deliveredCurrencyId!: string;

  @IsNotEmpty()
  @Matches(AMOUNT_REGEX, { message: 'deliveredAmount must be a positive decimal string' })
  deliveredAmount!: MoneyString;

  @IsUUID()
  paymentCurrencyId!: string;

  @IsOptional()
  @Matches(RATE_REGEX, { message: 'rate must be a positive decimal string' })
  rate?: MoneyString;

  @IsOptional()
  @Matches(AMOUNT_REGEX, { message: 'paymentTotal must be a positive decimal string' })
  paymentTotal?: MoneyString;

  @IsOptional()
  @Matches(AMOUNT_REGEX, { message: 'immediatePayment must be a non-negative decimal string' })
  immediatePayment?: MoneyString;

  @IsOptional()
  @IsUUID()
  paymentMethodId?: string;

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

  @IsOptional()
  @IsNotEmpty()
  @MaxLength(200)
  idempotencyKey?: string;

  // Sale-specific: walk-in transfers may name a recipient without a
  // contact_id, and note a destination ("family transfer to Dubai").
  // Free-form; not indexed; auditable via the sale row.
  @IsOptional()
  @MaxLength(200)
  recipientName?: string;

  @IsOptional()
  @MaxLength(500)
  destination?: string;
}
