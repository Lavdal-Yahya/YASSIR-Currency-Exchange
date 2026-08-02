import { IsBoolean, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

// Partial update; every field is optional. `goLiveAt` is *not* in this
// DTO — go-live has its own endpoint so the audit action carries the
// intent (`settings.went_live`), not a diff of a nullable timestamp.

export class UpdateSettingsDto {
  @IsOptional()
  @IsUUID()
  baseCurrencyId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  // Matches the CHECK constraint on settings.business_timezone.
  @Matches(/^(?:[A-Za-z_]+(?:\/[A-Za-z_]+)*|UTC)$/, {
    message: 'businessTimezone must be an IANA identifier',
  })
  businessTimezone?: string;

  @IsOptional()
  @IsBoolean()
  negativeBalanceOverrideAllowed?: boolean;
}
