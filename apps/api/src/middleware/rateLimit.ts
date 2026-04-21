import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redis } from '../cache/redis.js';

function buildStore(prefix: string) {
  return new RedisStore({
    // `sendCommand` is the lowest-common-denominator hook ioredis exposes.
    sendCommand: (...args: string[]) => redis.call(args[0]!, ...args.slice(1)) as Promise<any>,
    prefix,
  });
}

/** Aggressive limiter for auth endpoints (by IP). */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  store: buildStore('rl:auth:'),
});

/** Default limiter for external-API proxies (weather / places). */
export const externalProxyLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  store: buildStore('rl:ext:'),
});
