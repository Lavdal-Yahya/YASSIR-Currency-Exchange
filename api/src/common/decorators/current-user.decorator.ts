import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

// The JWT strategy attaches `req.user = { id, phone }`. This decorator
// pulls that out of the request. Prefer this over `req.user` in
// controllers.
export interface AuthUser {
  id: string;
  phone: string;
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
