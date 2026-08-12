import { IsString, MinLength } from 'class-validator';

// All four reversal endpoints share the same body shape: a mandatory
// reason. Rejected as 422 if empty or missing (spec §16.4).
export class ReverseDto {
  @IsString()
  @MinLength(1)
  reason!: string;
}
