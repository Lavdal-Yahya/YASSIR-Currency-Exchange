import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

// `code` is deliberately absent from the update DTO — it becomes
// immutable once any ledger references the currency (from P3), and
// leaving it out here is cheap prevention now. Renaming is possible
// via a supersede-and-migrate script, out of scope for CRUD.
//
// `isActive` is not toggled here either — deactivate/reactivate have
// their own endpoints so audit records carry the intent, not just a
// diff of booleans.

export class UpdateCurrencyDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  symbol?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  decimalPlaces?: number;

  @IsOptional()
  @IsString()
  @Matches(/^\d+(\.\d+)?$/, { message: 'lowBalanceThreshold must be a decimal string' })
  lowBalanceThreshold?: string | null;
}
