import { Inject, Injectable } from '@nestjs/common';
import type { Redis as RedisClient } from 'ioredis';
import { REDIS_CLIENT } from './redis.constants.js';

/** JSON cache helper that mirrors the legacy `readJson/writeJson` in src/cache/redis.ts. */
@Injectable()
export class RedisService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: RedisClient) {}

  get client(): RedisClient {
    return this.redis;
  }

  async readJson<T>(key: string): Promise<T | null> {
    const raw = await this.redis.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async writeJson<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  }
}
