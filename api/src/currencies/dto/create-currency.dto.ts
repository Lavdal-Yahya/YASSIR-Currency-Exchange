import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

// Kept close to the CHECK constraints in the migration — the DB is the
// last line of defense, this is the first. The regex here matches the
// currency_code_shape check verbatim, so a bad payload fails at the
// controller with a helpful i18n key rather than as a constraint
// violation from Postgres.
//
// `low_balance_threshold` is money-shaped and therefore a STRING on the
// wire (D-002 + convention §3). Zod would be a lighter fit but the API
// side uses class-validator throughout — one library per side.

export class CreateCurrencyDto {
  @IsString()
  @Matches(/^[A-Z0-9]{3,10}$/, { message: 'code must be 3–10 uppercase letters or digits' })
  code!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  symbol?: string;

  @IsInt()
  @Min(0)
  @Max(6)
  decimalPlaces!: number;

  @IsOptional()
  @IsString()
  @Matches(/^\d+(\.\d+)?$/, { message: 'lowBalanceThreshold must be a decimal string' })
  lowBalanceThreshold?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
