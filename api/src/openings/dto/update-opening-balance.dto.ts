import { IsDateString, IsOptional } from 'class-validator';

// Only effective_date is mutable. Quantity and unit-cost changes are
// reversal territory (P6-04) — modelling them here would require a
// compensating ledger entry, out of scope for P3.
export class UpdateOpeningBalanceDto {
  @IsOptional()
  @IsDateString()
  effectiveDate?: string;
}
