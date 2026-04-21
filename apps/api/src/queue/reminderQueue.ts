import { Queue, QueueEvents, Worker, type Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { todos as todoRemindersTable, trips, tripParticipants } from '../db/schema/index.js';
import { emailJobLogs, type EmailJobDetail } from '../db/schema/emailJobLogs.js';
import { env } from '../config/env.js';
import { bullConnection } from './connection.js';

export const REMINDER_QUEUE_NAME = 'trip-reminders';

export interface ReminderJobData {
  todoId: string;
  tripId: string;
}

export const reminderQueue = new Queue<ReminderJobData>(REMINDER_QUEUE_NAME, {
  connection: bullConnection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 60 * 1000 },
    removeOnComplete: { age: 7 * 24 * 60 * 60, count: 1000 },
    removeOnFail: { age: 30 * 24 * 60 * 60 },
  },
});

let reminderWorker: Worker<ReminderJobData> | null = null;
let queueEvents: QueueEvents | null = null;

export async function enqueueReminder(params: {
  jobId: string;
  todoId: string;
  tripId: string;
  delayMs: number;
}): Promise<void> {
  // Remove a prior scheduling of the same job if present — todo edits re-schedule.
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

export async function cancelReminder(jobId: string): Promise<void> {
  const existing = await reminderQueue.getJob(jobId);
  if (!existing) return;
  await existing.remove().catch((err) => {
    console.error(`[reminderQueue] failed to remove job ${jobId}`, err);
  });
}

export async function cancelRemindersForTrip(tripId: string): Promise<void> {
  const rows = await db
    .select({ id: todoRemindersTable.id, jobId: todoRemindersTable.jobId })
    .from(todoRemindersTable)
    .where(eq(todoRemindersTable.tripId, tripId));
  await Promise.all(
    rows.map((r) => {
      const jobId = r.jobId ?? `reminder:${r.id}`;
      return cancelReminder(jobId);
    }),
  );
}

export function ensureReminderWorker(): Worker<ReminderJobData> {
  if (reminderWorker) return reminderWorker;
  reminderWorker = new Worker<ReminderJobData>(
    REMINDER_QUEUE_NAME,
    processReminderJob,
    { connection: bullConnection, concurrency: 5 },
  );
  reminderWorker.on('failed', (job, err) => {
    console.error(`[reminderWorker] job ${job?.id} failed`, err);
  });
  reminderWorker.on('completed', (job) => {
    console.log(`[reminderWorker] job ${job.id} completed`);
  });
  return reminderWorker;
}

export async function closeReminderQueue(): Promise<void> {
  await Promise.all([
    reminderWorker?.close(),
    queueEvents?.close(),
    reminderQueue.close(),
  ]);
  reminderWorker = null;
  queueEvents = null;
}

async function processReminderJob(job: Job<ReminderJobData>): Promise<EmailJobDetail> {
  const triggeredAt = new Date();

  const [row] = await db
    .select({
      todo: todoRemindersTable,
      trip: trips,
      participant: tripParticipants,
    })
    .from(todoRemindersTable)
    .leftJoin(trips, eq(trips.id, todoRemindersTable.tripId))
    .leftJoin(
      tripParticipants,
      eq(tripParticipants.id, todoRemindersTable.assignedParticipantId),
    )
    .where(eq(todoRemindersTable.id, job.data.todoId))
    .limit(1);

  if (!row || !row.todo) {
    const detail: EmailJobDetail = {
      todo_id: job.data.todoId,
      task_name: '',
      trip_title: '',
      status: 'abandoned',
      retry_count: job.attemptsMade,
      error: 'todo no longer exists',
    };
    await writeJobLog(triggeredAt, 0, 0, [detail]);
    return detail;
  }
  if (row.todo.isNotified) {
    const detail: EmailJobDetail = {
      todo_id: row.todo.id,
      task_name: row.todo.taskName,
      trip_title: row.trip?.title ?? '',
      status: 'sent',
      retry_count: row.todo.retryCount,
      error: 'already notified — no-op',
    };
    return detail;
  }

  const fallback = env.REMINDER_FALLBACK_EMAIL ?? '';
  const recipient = row.participant?.email?.trim() || fallback;
  if (!recipient) {
    const detail: EmailJobDetail = {
      todo_id: row.todo.id,
      task_name: row.todo.taskName,
      trip_title: row.trip?.title ?? '',
      status: 'failed',
      retry_count: job.attemptsMade,
      error: 'no recipient email available (participant + REMINDER_FALLBACK_EMAIL both empty)',
    };
    await writeJobLog(triggeredAt, 1, 0, [detail]);
    throw new Error(detail.error);
  }

  const tripTitle = row.trip?.title ?? '未命名行程';
  const subject = `【提醒】${tripTitle} 的待辦：${row.todo.taskName}`;
  const htmlContent = `<strong>時間到囉！</strong><br>您在行程「<strong>${escapeHtml(tripTitle)}</strong>」中設定的待辦事項「<strong>${escapeHtml(row.todo.taskName)}</strong>」已經到期了，請趕快去處理吧！`;

  try {
    await sendBrevoEmail({ to: recipient, subject, htmlContent });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const newCount = row.todo.retryCount + 1;
    await db
      .update(todoRemindersTable)
      .set({ retryCount: newCount })
      .where(eq(todoRemindersTable.id, row.todo.id));
    const detail: EmailJobDetail = {
      todo_id: row.todo.id,
      task_name: row.todo.taskName,
      trip_title: tripTitle,
      status: 'failed',
      retry_count: newCount,
      error: message,
    };
    await writeJobLog(triggeredAt, 1, 0, [detail]);
    throw err;
  }

  await db
    .update(todoRemindersTable)
    .set({ isNotified: true })
    .where(eq(todoRemindersTable.id, row.todo.id));
  const detail: EmailJobDetail = {
    todo_id: row.todo.id,
    task_name: row.todo.taskName,
    trip_title: tripTitle,
    status: 'sent',
    retry_count: row.todo.retryCount,
  };
  await writeJobLog(triggeredAt, 1, 1, [detail]);
  return detail;
}

async function sendBrevoEmail(payload: { to: string; subject: string; htmlContent: string }): Promise<void> {
  const apiKey = env.BREVO_API_KEY;
  const senderEmail = env.BREVO_SENDER_EMAIL;
  if (!apiKey || !senderEmail) {
    throw new Error('BREVO_API_KEY / BREVO_SENDER_EMAIL not configured');
  }
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      sender: { name: 'Trip Planner', email: senderEmail },
      to: [{ email: payload.to }],
      subject: payload.subject,
      htmlContent: payload.htmlContent,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Brevo ${res.status}: ${body}`);
  }
}

async function writeJobLog(
  triggeredAt: Date,
  totalFound: number,
  sentCount: number,
  details: EmailJobDetail[],
): Promise<void> {
  try {
    await db.insert(emailJobLogs).values({
      triggeredAt,
      totalFound,
      sentCount,
      details,
      source: 'bullmq',
    });
  } catch (err) {
    console.error('[reminderQueue] failed to write email_job_logs', err);
  }
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
