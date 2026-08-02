import { HttpStatus } from '@nestjs/common';
import { DomainError } from '../common/errors/domain.error.js';

export class UserNotFoundError extends DomainError {
  readonly code = 'user_not_found';
  readonly i18nKey = 'error.user_not_found';
  readonly status = HttpStatus.NOT_FOUND;

  constructor(id: string) {
    super(`user not found: ${id}`, { id });
  }
}

// Refuses `POST /users/:me/deactivate`. An owner who deactivates herself
// locks the tenant out of user management — the only fix is a shell into
// the DB. Guarded here and covered by an integration test.
export class CannotDeactivateSelfError extends DomainError {
  readonly code = 'cannot_deactivate_self';
  readonly i18nKey = 'error.cannot_deactivate_self';
  readonly status = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor() {
    super('users cannot deactivate their own account');
  }
}

// Same shape as above but for role changes — an owner cannot demote
// herself out of the OWNER role in a single request. Prevents the "sole
// owner accidentally removes owner" foot-gun.
export class CannotStripOwnRoleError extends DomainError {
  readonly code = 'cannot_strip_own_owner_role';
  readonly i18nKey = 'error.cannot_strip_own_owner_role';
  readonly status = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor() {
    super('owners cannot strip their own owner role');
  }
}
