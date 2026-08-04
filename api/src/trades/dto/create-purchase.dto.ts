import { IsDateString, IsNotEmpty, IsOptional, IsUUID, Matches, MaxLength } from 'class-validator';
import type { MoneyString } from '../../common/money.js';

// Money on the wire is a string (D-002). Amounts use up to 4dp;
// rate uses up to 8dp; both regexes reject bare numbers and scientific
// notation. The service re-parses via new Decimal(...), so the DTO's
// only job is shape + type + trivial range.

const AMOUNT_REGEX = /^\d+(\.\d{1,4})?$/;
const RATE_REGEX = /^\d+(\.\d{1,8})?$/;

export class CreatePurchaseDto {
  /** Optional — walk-in trades have no contact. Deliberately not required. */
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

  // At least one of rate/paymentTotal must be present (server derives
  // the other). Both is allowed — server checks strict equality
  // (D-024).
  @IsOptional()
  @Matches(RATE_REGEX, { message: 'rate must be a positive decimal string' })
  rate?: MoneyString;

  @IsOptional()
  @Matches(AMOUNT_REGEX, { message: 'paymentTotal must be a positive decimal string' })
  paymentTotal?: MoneyString;

  @IsOptional()
  @Matches(AMOUNT_REGEX, { message: 'immediatePayment must be a non-negative decimal string' })
  immediatePayment?: MoneyString;

  // Required when immediatePayment > 0 (D-020, checked in the service —
  // class-validator can't cross-reference fields cleanly).
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

  /**
   * ISO string. If omitted, service uses `new Date()` (now). Backdating
   * is allowed per spec §9.2 / §11.1 — the cost engine orders by
   * ledger sequence, not transaction_date (D-008).
   */
  @IsOptional()
  @IsDateString()
  transactionDate?: string;

  /**
   * Idempotency key. Optional at the DTO layer (tests may omit) but
   * the controller passes an Idempotency-Key header through here so
   * doubled submits are caught (P4-06).
   */
  @IsOptional()
  @IsNotEmpty()
  @MaxLength(200)
  idempotencyKey?: string;

  // "At least one of rate / paymentTotal" is enforced in the service
  // via RateTotalMismatchError — see trade-common.deriveRateAndTotal.
}
