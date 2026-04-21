import Redis, { type Redis as RedisClient } from 'ioredis';
import { env, isTest } from '../config/env.js';

/** Shared ioredis connection for generic cache reads + the rate-limit store. */
export const redis: RedisClient = new Redis(env.REDIS_URL, {
  // BullMQ requires maxRetriesPerRequest: null on its own connection; we intentionally
  // keep this default for non-queue traffic so a dead Redis doesn't hang requests.
  lazyConnect: false,
  enableReadyCheck: true,
});

if (!isTest) {
  redis.on('error', (err) => {
    console.error('[redis] error', err);
  });
}

/** JSON helper with TTL (seconds). Returns null on miss. */
export async function readJson<T>(key: string): Promise<T | null> {
  const raw = await redis.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function writeJson<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
}
