import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy, type StrategyOptions } from 'passport-jwt';
import type { Request } from 'express';
import { APP_CONFIG, type AppConfig } from '../../config/config.module.js';
import type { AdminTokenPayload } from '../../common/decorators/current-admin.decorator.js';
import { AuthService, ACCESS_COOKIE_NAME } from './auth.service.js';

/** Cookie or Authorization Bearer header — same precedence as the legacy `requireAdmin`. */
function cookieOrBearerExtractor(): (req: Request) => string | null {
  const fromBearer = ExtractJwt.fromAuthHeaderAsBearerToken();
  return (req: Request): string | null => {
    const cookies = (req.cookies as Record<string, string> | undefined) ?? {};
    if (cookies[ACCESS_COOKIE_NAME]) return cookies[ACCESS_COOKIE_NAME] ?? null;
    return fromBearer(req);
  };
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    private readonly authService: AuthService,
  ) {
    const options: StrategyOptions = {
      jwtFromRequest: cookieOrBearerExtractor(),
      secretOrKey: config.JWT_SECRET,
      issuer: 'trip-planner',
      audience: 'trip-planner-admin',
      passReqToCallback: false,
    };
    super(options);
  }

  /** passport-jwt only verifies signature/exp — we additionally check Redis revocation. */
  async validate(payload: AdminTokenPayload): Promise<AdminTokenPayload> {
    if (!payload.sub) throw new UnauthorizedException('Invalid token');
    if (payload.jti && (await this.authService.isRevoked(payload.jti))) {
      throw new UnauthorizedException('Session revoked');
    }
    return payload;
  }
}
