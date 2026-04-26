import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { HttpError } from '../exceptions/http.exception.js';

/**
 * Replaces the legacy `requireAdmin` middleware. Uses passport-jwt under the hood,
 * but throws our own HttpError for parity:
 *   - No token  → 請先登入
 *   - Bad/expired token → Invalid or expired token
 */
@Injectable()
export class AdminGuard extends AuthGuard('jwt') {
  override handleRequest<TUser>(
    err: unknown,
    user: TUser,
    info: unknown,
    _ctx: ExecutionContext,
  ): TUser {
    if (err instanceof HttpError) throw err;
    if (err) throw HttpError.unauthorized('Invalid or expired token');
    if (!user) {
      // passport-jwt sets info=Error('No auth token') when nothing extracts the token.
      // Other info values (TokenExpiredError, JsonWebTokenError, …) mean a token WAS
      // present but invalid — preserve the legacy distinction.
      if (info instanceof Error && info.message === 'No auth token') {
        throw HttpError.unauthorized('請先登入');
      }
      throw HttpError.unauthorized('Invalid or expired token');
    }
    return user;
  }

  override getRequest(context: ExecutionContext): Request {
    return context.switchToHttp().getRequest<Request>();
  }
}
