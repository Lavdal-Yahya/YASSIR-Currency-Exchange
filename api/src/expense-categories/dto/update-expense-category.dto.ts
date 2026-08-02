import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

// Rename is allowed — the category's semantic identity is its ID, not
// its label. Activation state is toggled via /deactivate + /reactivate,
// not PATCH.
export class UpdateExpenseCategoryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name?: string;
}
