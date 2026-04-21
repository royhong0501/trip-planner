/**
 * Rebuild BullMQ delayed jobs for every pending todo reminder.
 *
 * Scans the `todos` table for rows where `reminder_time` is still in the
 * future and `is_notified = false`, then enqueues / re-enqueues a
 * `reminder:{id}` job and writes the returned jobId back to the row.
 *
 * Safe to run repeatedly — `enqueueReminder` removes any existing job
 * with the same jobId before adding a new one.
 *
 * Usage:
 *   pnpm --filter @trip-planner/api exec tsx scripts/reseedReminders.ts
 */

import 'dotenv/config';
import { and, eq, gt } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { todos } from '../src/db/schema/todos.js';
import { enqueueReminder, reminderQueue } from '../src/queue/reminderQueue.js';

async function main(): Promise<void> {
  const now = new Date();
  const pending = await db
    .select({
      id: todos.id,
      tripId: todos.tripId,
      reminderTime: todos.reminderTime,
      jobId: todos.jobId,
    })
    .from(todos)
    .where(and(eq(todos.isNotified, false), gt(todos.reminderTime, now)));

  console.log(`[reseedReminders] ${pending.length} pending reminder(s) in window`);

  let ok = 0;
  let fail = 0;
  for (const row of pending) {
    const jobId = row.jobId ?? `reminder:${row.id}`;
    const delayMs = row.reminderTime.getTime() - Date.now();
    try {
      await enqueueReminder({
        jobId,
        todoId: row.id,
        tripId: row.tripId,
        delayMs,
      });
      if (!row.jobId) {
        await db.update(todos).set({ jobId }).where(eq(todos.id, row.id));
      }
      ok += 1;
    } catch (err) {
      fail += 1;
      console.error(`[reseedReminders] failed for todo ${row.id}`, err);
    }
  }

  console.log(`[reseedReminders] done. ok=${ok} fail=${fail}`);
  await reminderQueue.close();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[reseedReminders] top-level error', err);
  process.exit(1);
});
