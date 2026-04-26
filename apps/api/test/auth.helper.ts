import jwt from 'jsonwebtoken';
import { ACCESS_COOKIE_NAME } from '../src/modules/auth/auth.service.js';

/** Mints a valid admin token using the same secret/issuer/audience as AuthService. */
export function adminCookie(opts: { sub?: string; email?: string } = {}): string {
  const sub = opts.sub ?? '00000000-0000-0000-0000-000000000001';
  const email = opts.email ?? 'admin@example.com';
  const token = jwt.sign(
    { sub, email },
    process.env.JWT_SECRET!,
    {
      expiresIn: 3600,
      issuer: 'trip-planner',
      audience: 'trip-planner-admin',
      jwtid: 'test-jti',
    },
  );
  return `${ACCESS_COOKIE_NAME}=${token}`;
}

export function bearerHeader(opts: { sub?: string; email?: string } = {}): string {
  const sub = opts.sub ?? '00000000-0000-0000-0000-000000000001';
  const email = opts.email ?? 'admin@example.com';
  const token = jwt.sign(
    { sub, email },
    process.env.JWT_SECRET!,
    {
      expiresIn: 3600,
      issuer: 'trip-planner',
      audience: 'trip-planner-admin',
      jwtid: 'test-jti',
    },
  );
  return `Bearer ${token}`;
}
