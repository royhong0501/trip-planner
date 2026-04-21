import bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import jwt, { type JwtPayload, type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env.js';
import { db } from '../db/client.js';
import { adminUsers } from '../db/schema/index.js';
import { HttpError } from '../utils/httpError.js';
import { redis } from '../cache/redis.js';

export const ACCESS_COOKIE_NAME = 'tp_admin';
const REVOCATION_PREFIX = 'revoked_jti:';

export interface AdminTokenPayload extends JwtPayload {
  sub: string;
  email: string;
  jti: string;
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export function signAccessToken(payload: { sub: string; email: string }): {
  token: string;
  expiresAt: Date;
} {
  const expiresIn = env.JWT_ACCESS_TTL;
  const jti = cryptoRandomId();
  const options: SignOptions = {
    expiresIn,
    issuer: 'trip-planner',
    audience: 'trip-planner-admin',
    jwtid: jti,
  };
  const token = jwt.sign({ sub: payload.sub, email: payload.email }, env.JWT_SECRET, options);
  const expiresAt = new Date(Date.now() + expiresIn * 1000);
  return { token, expiresAt };
}

export async function verifyAccessToken(token: string): Promise<AdminTokenPayload> {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, {
      issuer: 'trip-planner',
      audience: 'trip-planner-admin',
    }) as AdminTokenPayload;
    if (decoded.jti && (await redis.get(REVOCATION_PREFIX + decoded.jti))) {
      throw HttpError.unauthorized('Session revoked');
    }
    return decoded;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw HttpError.unauthorized('Invalid or expired token');
  }
}

export async function revokeToken(decoded: AdminTokenPayload): Promise<void> {
  if (!decoded.jti || !decoded.exp) return;
  const ttl = Math.max(1, decoded.exp - Math.floor(Date.now() / 1000));
  await redis.set(REVOCATION_PREFIX + decoded.jti, '1', 'EX', ttl);
}

export async function findAdminByEmail(email: string) {
  const [row] = await db
    .select()
    .from(adminUsers)
    .where(eq(adminUsers.email, email.trim().toLowerCase()))
    .limit(1);
  return row ?? null;
}

export async function findAdminById(id: string) {
  const [row] = await db.select().from(adminUsers).where(eq(adminUsers.id, id)).limit(1);
  return row ?? null;
}

function cryptoRandomId(): string {
  // Use Web Crypto in Node 20+
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}
