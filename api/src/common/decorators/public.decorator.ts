import { SetMetadata } from '@nestjs/common';

// Mark a route as unauthenticated. The global JwtAuthGuard bypasses these.
// The route-table test in P1-07 treats @Public and @RequirePermission as
// the only two acceptable states — any handler with neither fails CI.
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
