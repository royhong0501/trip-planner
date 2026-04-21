import { createApp } from './app.js';
import { env } from './config/env.js';
import { prisma } from './db/client.js';
import { redis } from './cache/redis.js';
import { closeReminderQueue, ensureReminderWorker } from './queue/reminderQueue.js';

async function main() {
  const app = createApp();

  // Fire up the embedded reminder worker in dev/single-process deployments.
  // In production you'll likely run the worker separately via `npm run worker:reminder`.
  if (env.NODE_ENV !== 'test') {
    ensureReminderWorker();
  }

  const server = app.listen(env.PORT, () => {
    console.log(`[api] listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
  });

  const shutdown = async (signal: string) => {
    console.log(`[api] received ${signal}, shutting down`);
    server.close();
    await closeReminderQueue().catch((err) => console.error('[queue] close error', err));
    await redis.quit().catch(() => redis.disconnect());
    await prisma.$disconnect().catch((err) => console.error('[prisma] close error', err));
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

main().catch((err) => {
  console.error('[api] failed to boot', err);
  process.exit(1);
});
