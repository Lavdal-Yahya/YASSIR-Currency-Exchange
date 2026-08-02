import { ArrayUnique, IsArray, IsIn, IsString } from 'class-validator';

// Replaces the user's role set atomically. Empty array is allowed — a
// user with no roles can log in but has no permissions (visible in
// audit as `roles: []`). Owner UX should refuse this in the form; the
// server accepts it so the recovery path exists.
export class SetUserRolesDto {
  @IsArray()
  @IsString({ each: true })
  @IsIn(['OWNER', 'EMPLOYEE'], { each: true })
  @ArrayUnique()
  roles!: string[];
}
