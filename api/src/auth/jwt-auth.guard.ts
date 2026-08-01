import { Injectable, type ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import type { Observable } from 'rxjs';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator.js';

// Global guard. Every route requires a valid session cookie unless the
// handler (or its controller) is marked @Public. P1-07's route-table
// test asserts that no handler slips through with neither @Public nor
// @RequirePermission.

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  override canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }
}
