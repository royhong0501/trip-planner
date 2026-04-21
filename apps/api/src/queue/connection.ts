import Redis, { type Redis as RedisClient } from 'ioredis';
import { env } from '../config/env.js';

/**
 * BullMQ requires `maxRetriesPerRequest: null` and `enableReadyCheck: false` on its
 * connection, so it gets its own dedicated ioredis instance.
 */
export const bullConnection: RedisClient = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

bullConnection.on('error', (err) => {
  console.error('[bullmq:redis] error', err);
});
