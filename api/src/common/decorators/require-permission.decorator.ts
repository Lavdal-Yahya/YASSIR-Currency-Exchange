import { SetMetadata } from '@nestjs/common';
import type { PermissionCode } from '../permissions.js';

// Declares which permission a handler needs. The metadata is read by
// PermissionGuard, which is installed globally after JwtAuthGuard.
//
// Multiple codes = OR (the caller needs any one of them). If a route
// needs an AND check, split it into two decorators or write the check
// inline — the AND case is rare and less readable when hidden inside
// a decorator.
export const REQUIRED_PERMISSIONS_KEY = 'requiredPermissions';
export const RequirePermission = (
  ...codes: [PermissionCode, ...PermissionCode[]]
): MethodDecorator & ClassDecorator => SetMetadata(REQUIRED_PERMISSIONS_KEY, codes);
