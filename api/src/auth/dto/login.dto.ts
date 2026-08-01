import { IsString, Matches, MinLength } from 'class-validator';

export class LoginDto {
  // Phone stays a plain string; contact normalization is out of scope for
  // login. The DB-level UNIQUE index makes the format the operator's
  // problem, not ours.
  @IsString()
  @MinLength(5)
  phone!: string;

  @IsString()
  @Matches(/^\d{4,8}$/, { message: 'PIN must be 4-8 digits' })
  pin!: string;
}
