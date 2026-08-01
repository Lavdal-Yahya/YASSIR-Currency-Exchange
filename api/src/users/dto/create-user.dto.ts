import { IsArray, IsBoolean, IsIn, IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsString()
  @MinLength(1)
  fullName!: string;

  @IsString()
  @MinLength(5)
  phone!: string;

  @IsString()
  @Matches(/^\d{4,8}$/, { message: 'PIN must be 4-8 digits' })
  pin!: string;

  // Role codes to grant. Empty is allowed but useless — the user could
  // sign in and see nothing. Kept permissive at the API level so an
  // owner can set roles up in a follow-up request if they want.
  @IsArray()
  @IsIn(['OWNER', 'EMPLOYEE'], { each: true })
  @IsOptional()
  roles?: string[];

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
