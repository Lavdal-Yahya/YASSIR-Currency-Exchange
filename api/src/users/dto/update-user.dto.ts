import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

// Phone is not editable — auth relies on it, and audit rows reference it
// by hash-of-context. Renaming (fullName) is safe. Activation state is
// toggled via /deactivate + /reactivate. PIN reset lives on its own
// endpoint.
export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  fullName?: string;
}
