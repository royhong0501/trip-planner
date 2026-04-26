import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { CookieOptions, Request, Response } from 'express';
import { loginSchema } from '@trip-planner/shared-schema';
import { APP_CONFIG, type AppConfig } from '../../config/config.module.js';
import {
  CurrentAdmin,
  type AdminTokenPayload,
} from '../../common/decorators/current-admin.decorator.js';
import { AdminGuard } from '../../common/guards/admin.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { HttpError } from '../../common/exceptions/http.exception.js';
import { ACCESS_COOKIE_NAME, AuthService } from './auth.service.js';

@Controller('api/auth')
export class AuthController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly authService: AuthService,
  ) {}

  /** Aggressive limit: 20 attempts per 15 minutes (matches legacy authLimiter). */
  @Throttle({ auth: { limit: 20, ttl: 15 * 60 * 1000 } })
  @Post('login')
  @HttpCode(200)
  @UsePipes(new ZodValidationPipe(loginSchema))
  async login(
    @Body() body: { email: string; password: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const admin = await this.authService.findAdminByEmail(body.email);
    // Always verify against a hash even when the user is missing — keeps timing even.
    const ok = admin
      ? await this.authService.verifyPassword(body.password, admin.passwordHash)
      : false;
    if (!admin || !ok) {
      throw HttpError.unauthorized('帳號或密碼錯誤');
    }

    const { token, expiresAt } = this.authService.signAccessToken({
      sub: admin.id,
      email: admin.email,
    });
    res.cookie(
      ACCESS_COOKIE_NAME,
      token,
      this.cookieOptions(this.config.JWT_ACCESS_TTL * 1000),
    );
    return {
      user: {
        id: admin.id,
        email: admin.email,
        createdAt: admin.createdAt.toISOString(),
      },
      expiresAt: expiresAt.toISOString(),
    };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = (req.cookies as Record<string, string> | undefined)?.[ACCESS_COOKIE_NAME];
    if (token) {
      try {
        const payload = await this.authService.verifyAccessToken(token);
        await this.authService.revokeToken(payload);
      } catch {
        // logout is idempotent even if the cookie was bad
      }
    }
    res.clearCookie(ACCESS_COOKIE_NAME, this.cookieOptions(0));
  }

  @Get('me')
  @UseGuards(AdminGuard)
  async me(@CurrentAdmin() admin: AdminTokenPayload) {
    const row = await this.authService.findAdminById(admin.sub);
    if (!row) throw HttpError.unauthorized('帳號不存在');
    const expMs = (admin.exp ?? Math.floor(Date.now() / 1000)) * 1000;
    return {
      user: {
        id: row.id,
        email: row.email,
        createdAt: row.createdAt.toISOString(),
      },
      expiresAt: new Date(expMs).toISOString(),
    };
  }

  private cookieOptions(maxAgeMs: number): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.COOKIE_SECURE || this.config.NODE_ENV === 'production',
      domain: this.config.COOKIE_DOMAIN || undefined,
      path: '/',
      maxAge: maxAgeMs,
    };
  }
}
