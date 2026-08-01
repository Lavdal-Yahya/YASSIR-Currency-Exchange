import { CanActivate, ForbiddenException, Injectable, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PrismaService } from '../common/prisma.service.js';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator.js';
import { IS_AUTHENTICATED_KEY } from '../common/decorators/authenticated.decorator.js';
import { REQUIRED_PERMISSIONS_KEY } from '../common/decorators/require-permission.decorator.js';
import type { AuthUser } from '../common/decorators/current-user.decorator.js';

// PermissionGuard sits AFTER JwtAuthGuard in the global guard chain.
// The order matters: JwtAuthGuard populates req.user; PermissionGuard
// reads it. A route without @RequirePermission and without @Public
// fails closed here — the route-table test in test/routes.test.ts
// asserts that no handler slips through in either direction.
//
// Permissions are resolved per request and stashed on req.user so
// repeated checks within one handler don't re-query. Nothing else
// caches — v1 has one process, one Postgres, and the auth query is
// two joins on tiny tables.

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    // @Authenticated — a valid session is enough.
    if (this.reflector.getAllAndOverride<boolean>(IS_AUTHENTICATED_KEY, targets)) {
      const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
      if (!req.user) throw new ForbiddenException();
      return true;
    }

    const required = this.reflector.getAllAndOverride<string[]>(REQUIRED_PERMISSIONS_KEY, targets);
    // Handler without @RequirePermission and without @Public/@Authenticated
    // — fail closed. The route-table test asserts this never happens by
    // construction, but keeping the runtime guard is what makes "fail
    // closed" true.
    if (!required || required.length === 0) {
      throw new ForbiddenException('Route has no permission requirement');
    }

    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    if (!req.user) {
      // JwtAuthGuard should have populated this; a null user here means
      // the guard order was misconfigured. Fail closed.
      throw new ForbiddenException();
    }

    const codes = await this.loadPermissionsForUser(req.user.id);
    const hasAny = required.some((code) => codes.has(code));
    if (!hasAny) throw new ForbiddenException();
    return true;
  }

  private async loadPermissionsForUser(userId: string): Promise<Set<string>> {
    const rows = await this.prisma.rolePermission.findMany({
      where: { role: { users: { some: { userId } } } },
      select: { permission: { select: { code: true } } },
    });
    return new Set(rows.map((r) => r.permission.code));
  }
}
