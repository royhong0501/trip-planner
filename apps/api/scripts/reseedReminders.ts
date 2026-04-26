/**
 * Rebuild BullMQ delayed jobs for every pending todo reminder.
 *
 * Scans the `todos` table for rows where `reminder_time` is still in the
 * future and `is_notified = false`, then enqueues / re-enqueues a
 * `reminder:{id}` job and writes the returned jobId back to the row.
 *
 * Safe to run repeatedly — adding the same jobId removes the prior copy first.
 *
 * Usage:
 *   npm run -w @trip-planner/api exec -- tsx scripts/reseedReminders.ts
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { parseEnv } from '../src/config/env.schema.js';

const env = parseEnv();
const prisma = new PrismaClient({
  datasources: { db: { url: env.DATABASE_URL } },
});

const connection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

const reminderQueue = new Queue('trip-reminders', {
  connection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 60 * 1000 },
    removeOnComplete: { age: 7 * 24 * 60 * 60, count: 1000 },
    removeOnFail: { age: 30 * 24 * 60 * 60 },
  },
});

async function enqueueReminder(params: {
  jobId: string;
  todoId: string;
  tripId: string;
  delayMs: number;
}): Promise<void> {
  const existing = await reminderQueue.getJob(params.jobId);
  if (existing) {
    await existing.remove().catch(() => undefined);
  }
  await reminderQueue.add(
    'send-reminder',
    { todoId: params.todoId, tripId: params.tripId },
    { jobId: params.jobId, delay: Math.max(0, params.delayMs) },
  );
}

async function main(): Promise<void> {
  const now = new Date();
  const pending = await prisma.todo.findMany({
    where: {
      isNotified: false,
      reminderTime: { gt: now },
    },
    select: {
      id: true,
      tripId: true,
      reminderTime: true,
      jobId: true,
    },
  });

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
        await prisma.todo.update({
          where: { id: row.id },
          data: { jobId },
          select: { id: true },
        });
      }
      ok += 1;
    } catch (err) {
      fail += 1;
      console.error(`[reseedReminders] failed for todo ${row.id}`, err);
    }
  }

  console.log(`[reseedReminders] done. ok=${ok} fail=${fail}`);
  await reminderQueue.close();
  await connection.quit().catch(() => connection.disconnect());
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[reseedReminders] top-level error', err);
  process.exit(1);
});
