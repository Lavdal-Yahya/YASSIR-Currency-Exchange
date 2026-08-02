import { IsBoolean, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

// Matches the CHECK constraint on payment_method.code — 2-32 chars,
// starting with a letter, uppercase alphanumeric + underscore.
export class CreatePaymentMethodDto {
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{1,31}$/, {
    message: 'code must be uppercase alphanumeric (2–32 chars), letter first',
  })
  code!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(60)
  labelFr!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(60)
  labelAr!: string;

  @IsOptional()
  @IsBoolean()
  requiresNote?: boolean;
}
