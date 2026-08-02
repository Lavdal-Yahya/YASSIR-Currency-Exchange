import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

// Labels are editable; code and requiresNote are not.
// Renaming code would break historical ledger reads. requiresNote is a
// D-020 constant per method — OTHER always requires a note, the others
// never do; toggling it here would silently invalidate old ledger
// entries that were written without one.
export class UpdatePaymentMethodDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  labelFr?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  labelAr?: string;
}
