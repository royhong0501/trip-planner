import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export interface AdminTokenPayload {
  sub: string;
  email: string;
  jti?: string;
  exp?: number;
}

/**
 * Equivalent of `req.admin` in the legacy code. Populated by JwtStrategy
 * and AdminGuard. Use inside controllers to avoid digging into req.user.
 */
export const CurrentAdmin = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AdminTokenPayload => {
    const req = ctx.switchToHttp().getRequest<Request & { user?: AdminTokenPayload }>();
    if (!req.user) throw new Error('CurrentAdmin used without AdminGuard');
    return req.user;
  },
);
