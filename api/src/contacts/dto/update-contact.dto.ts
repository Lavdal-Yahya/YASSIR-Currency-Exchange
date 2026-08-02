import { IsBoolean, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

// PATCH is partial. `confirmDuplicate` is *not* accepted here — a
// phone-conflict on update is treated the same as on create (409
// warning, retry with confirm on the update endpoint too).

export class UpdateContactDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

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
