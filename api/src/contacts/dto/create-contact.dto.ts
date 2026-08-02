import { IsBoolean, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

// Mirrors the CHECK constraints on `contact` — name shape and phone
// shape enforced at both layers. `confirmDuplicate` is an explicit
// opt-in that bypasses the duplicate-phone warning; it lives in the
// body, not the URL, because it is data about the write, not a
// separate resource.

export class CreateContactDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @Matches(/^\+\d{6,15}$/, { message: 'phone must be E.164-ish (+ then 6–15 digits)' })
  phone?: string;

  @IsOptional()
  @IsBoolean()
  isCustomer?: boolean;

  @IsOptional()
  @IsBoolean()
  isSupplier?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsBoolean()
  confirmDuplicate?: boolean;
}
