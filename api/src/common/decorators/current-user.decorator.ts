import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

// The JWT strategy attaches `req.user = { id, phone }`. This decorator
// pulls that out of the request. Prefer this over `req.user` in
// controllers.
//
// `permissions` is populated by PermissionGuard when a route runs
// through it (which is every non-@Public route by construction). It
// is undefined on the strategy hand-off, and is a Set once the guard
// has resolved it — controllers that need it after that point can
// treat it as always present.
export interface AuthUser {
  id: string;
  phone: string;
  permissions?: Set<string>;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    if (!req.user) {
      throw new Error('CurrentUser used on a route without an authenticated user');
    }
    return req.user;
  },
);
