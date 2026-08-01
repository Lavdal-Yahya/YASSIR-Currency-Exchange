import { SetMetadata } from '@nestjs/common';

// Marks a route that requires a valid session but no specific
// permission — every authenticated user is allowed.
//
// The route-table test (P1-07) accepts three valid states for any
// controller handler:
//   - @Public                         — no auth
//   - @Authenticated                  — auth, any user
//   - @RequirePermission(...codes)    — auth + at least one code
// Anything else fails the test.
export const IS_AUTHENTICATED_KEY = 'isAuthenticated';
export const Authenticated = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_AUTHENTICATED_KEY, true);
