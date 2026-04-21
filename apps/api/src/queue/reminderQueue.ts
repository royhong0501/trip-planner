import { Queue, QueueEvents, Worker, type Job } from 'bullmq';
import { prisma } from '../db/client.js';
import { env } from '../config/env.js';
import { bullConnection } from './connection.js';

export const REMINDER_QUEUE_NAME = 'trip-reminders';

/**
 * Shape of each item in `email_job_logs.details`. Kept stable for admins who
 * pivot this JSON in ad-hoc queries (see docs/VERIFICATION.md).
 */
export interface EmailJobDetail {
  todo_id: string;
  task_name: string;
  trip_title: string;
  status: 'sent' | 'failed' | 'abandoned';
  retry_count: number;
  error?: string;
}

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
  const rows = await prisma.todo.findMany({
    where: { tripId },
    select: { id: true, jobId: true },
  });
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

  const todoRow = await prisma.todo.findUnique({
    where: { id: job.data.todoId },
    include: {
      trip: { select: { title: true } },
      assignedParticipant: { select: { email: true } },
    },
  });

  if (!todoRow) {
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
  if (todoRow.isNotified) {
    const detail: EmailJobDetail = {
      todo_id: todoRow.id,
      task_name: todoRow.taskName,
      trip_title: todoRow.trip?.title ?? '',
      status: 'sent',
      retry_count: todoRow.retryCount,
      error: 'already notified — no-op',
    };
    return detail;
  }

  const fallback = env.REMINDER_FALLBACK_EMAIL ?? '';
  const recipient = todoRow.assignedParticipant?.email?.trim() || fallback;
  if (!recipient) {
    const detail: EmailJobDetail = {
      todo_id: todoRow.id,
      task_name: todoRow.taskName,
      trip_title: todoRow.trip?.title ?? '',
      status: 'failed',
      retry_count: job.attemptsMade,
      error: 'no recipient email available (participant + REMINDER_FALLBACK_EMAIL both empty)',
    };
    await writeJobLog(triggeredAt, 1, 0, [detail]);
    throw new Error(detail.error);
  }

  const tripTitle = todoRow.trip?.title ?? '未命名行程';
  const subject = `【提醒】${tripTitle} 的待辦：${todoRow.taskName}`;
  const htmlContent = `<strong>時間到囉！</strong><br>您在行程「<strong>${escapeHtml(tripTitle)}</strong>」中設定的待辦事項「<strong>${escapeHtml(todoRow.taskName)}</strong>」已經到期了，請趕快去處理吧！`;

  try {
    await sendBrevoEmail({ to: recipient, subject, htmlContent });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const newCount = todoRow.retryCount + 1;
    await prisma.todo.update({
      where: { id: todoRow.id },
      data: { retryCount: newCount },
      select: { id: true },
    });
    const detail: EmailJobDetail = {
      todo_id: todoRow.id,
      task_name: todoRow.taskName,
      trip_title: tripTitle,
      status: 'failed',
      retry_count: newCount,
      error: message,
    };
    await writeJobLog(triggeredAt, 1, 0, [detail]);
    throw err;
  }

  await prisma.todo.update({
    where: { id: todoRow.id },
    data: { isNotified: true },
    select: { id: true },
  });
  const detail: EmailJobDetail = {
    todo_id: todoRow.id,
    task_name: todoRow.taskName,
    trip_title: tripTitle,
    status: 'sent',
    retry_count: todoRow.retryCount,
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
    await prisma.emailJobLog.create({
      data: {
        triggeredAt,
        totalFound,
        sentCount,
        details: details as object,
        source: 'bullmq',
      },
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
