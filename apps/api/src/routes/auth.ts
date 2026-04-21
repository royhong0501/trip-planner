import { Router } from 'express';
import type { CookieOptions } from 'express';
import { loginSchema } from '@trip-planner/shared-schema';
import { env, isProd } from '../config/env.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HttpError } from '../utils/httpError.js';
import {
  ACCESS_COOKIE_NAME,
  findAdminByEmail,
  findAdminById,
  revokeToken,
  signAccessToken,
  verifyPassword,
} from '../services/auth.js';

function cookieOptions(maxAgeMs: number): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.COOKIE_SECURE || isProd,
    domain: env.COOKIE_DOMAIN || undefined,
    path: '/',
    maxAge: maxAgeMs,
  };
}

export const authRouter = Router();

authRouter.post(
  '/login',
  authLimiter,
  validate(loginSchema, 'body'),
  asyncHandler<unknown, unknown, { email: string; password: string }>(async (req, res) => {
    const { email, password } = req.body;
    const admin = await findAdminByEmail(email);
    // Always verify against a hash even if the user doesn't exist, to keep timing even.
    const ok = admin ? await verifyPassword(password, admin.passwordHash) : false;
    if (!admin || !ok) {
      throw HttpError.unauthorized('帳號或密碼錯誤');
    }

    const { token, expiresAt } = signAccessToken({ sub: admin.id, email: admin.email });
    res.cookie(ACCESS_COOKIE_NAME, token, cookieOptions(env.JWT_ACCESS_TTL * 1000));
    res.json({
      user: {
        id: admin.id,
        email: admin.email,
        createdAt: admin.createdAt.toISOString(),
      },
      expiresAt: expiresAt.toISOString(),
    });
  }),
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const token = (req.cookies as Record<string, string> | undefined)?.[ACCESS_COOKIE_NAME];
    if (token) {
      try {
        const { verifyAccessToken } = await import('../services/auth.js');
        const payload = await verifyAccessToken(token);
        await revokeToken(payload);
      } catch {
        // swallow — logout is idempotent even if the cookie was bad.
      }
    }
    res.clearCookie(ACCESS_COOKIE_NAME, cookieOptions(0));
    res.status(204).end();
  }),
);

authRouter.get(
  '/me',
  requireAdmin,
  asyncHandler(async (req, res) => {
    if (!req.admin) throw HttpError.unauthorized();
    const admin = await findAdminById(req.admin.sub);
    if (!admin) throw HttpError.unauthorized('帳號不存在');
    const expMs = (req.admin.exp ?? Math.floor(Date.now() / 1000)) * 1000;
    res.json({
      user: {
        id: admin.id,
        email: admin.email,
        createdAt: admin.createdAt.toISOString(),
      },
      expiresAt: new Date(expMs).toISOString(),
    });
  }),
);
