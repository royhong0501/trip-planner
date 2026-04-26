import { Inject, Injectable } from '@nestjs/common';
import bcrypt from 'bcrypt';
import jwt, { type SignOptions } from 'jsonwebtoken';
import type { Redis as RedisClient } from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../../config/config.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { REDIS_CLIENT } from '../redis/redis.constants.js';
import { HttpError } from '../../common/exceptions/http.exception.js';
import type { AdminTokenPayload } from '../../common/decorators/current-admin.decorator.js';

export const ACCESS_COOKIE_NAME = 'tp_admin';
const REVOCATION_PREFIX = 'revoked_jti:';

/**
 * Mirrors the legacy src/services/auth.ts: bcrypt hashing, JWT sign/verify,
 * Redis-backed jti revocation, lookup helpers.
 */
@Injectable()
export class AuthService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: RedisClient,
  ) {}

  hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, 12);
  }

  verifyPassword(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }

  signAccessToken(payload: { sub: string; email: string }): {
    token: string;
    expiresAt: Date;
  } {
    const expiresIn = this.config.JWT_ACCESS_TTL;
    const jti = randomJti();
    const options: SignOptions = {
      expiresIn,
      issuer: 'trip-planner',
      audience: 'trip-planner-admin',
      jwtid: jti,
    };
    const token = jwt.sign(
      { sub: payload.sub, email: payload.email },
      this.config.JWT_SECRET,
      options,
    );
    const expiresAt = new Date(Date.now() + expiresIn * 1000);
    return { token, expiresAt };
  }

  async verifyAccessToken(token: string): Promise<AdminTokenPayload> {
    try {
      const decoded = jwt.verify(token, this.config.JWT_SECRET, {
        issuer: 'trip-planner',
        audience: 'trip-planner-admin',
      }) as AdminTokenPayload;
      if (decoded.jti && (await this.isRevoked(decoded.jti))) {
        throw HttpError.unauthorized('Session revoked');
      }
      return decoded;
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw HttpError.unauthorized('Invalid or expired token');
    }
  }

  async isRevoked(jti: string): Promise<boolean> {
    return Boolean(await this.redis.get(REVOCATION_PREFIX + jti));
  }

  async revokeToken(decoded: AdminTokenPayload): Promise<void> {
    if (!decoded.jti || !decoded.exp) return;
    const ttl = Math.max(1, decoded.exp - Math.floor(Date.now() / 1000));
    await this.redis.set(REVOCATION_PREFIX + decoded.jti, '1', 'EX', ttl);
  }

  findAdminByEmail(email: string) {
    return this.prisma.adminUser.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
  }

  findAdminById(id: string) {
    return this.prisma.adminUser.findUnique({ where: { id } });
  }
}

function randomJti(): string {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}
