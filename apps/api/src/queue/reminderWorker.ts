/**
 * Standalone entry for running the reminder worker in its own process.
 * Useful for production where the API and the worker are scaled independently.
 *
 *   npm run worker:reminder -w @trip-planner/api
 */
import { closeReminderQueue, ensureReminderWorker } from './reminderQueue.js';

const worker = ensureReminderWorker();
console.log('[worker:reminder] started');

const shutdown = async (signal: string) => {
  console.log(`[worker:reminder] received ${signal}, shutting down`);
  await closeReminderQueue().catch((err) => console.error('[worker:reminder] close error', err));
  process.exit(0);
};

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

// Keep a reference so imported modules aren't GC'd.
void worker;
