import type { NextFunction, Request, Response } from 'express';
import { ACCESS_COOKIE_NAME, verifyAccessToken, type AdminTokenPayload } from '../services/auth.js';
import { HttpError } from '../utils/httpError.js';

declare module 'express-serve-static-core' {
  interface Request {
    admin?: AdminTokenPayload;
  }
}

export async function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = extractToken(req);
    if (!token) {
      throw HttpError.unauthorized('請先登入');
    }
    const payload = await verifyAccessToken(token);
    req.admin = payload;
    next();
  } catch (err) {
    next(err);
  }
}

function extractToken(req: Request): string | null {
  const cookie = (req.cookies as Record<string, string> | undefined)?.[ACCESS_COOKIE_NAME];
  if (cookie) return cookie;
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice('Bearer '.length);
  return null;
}
