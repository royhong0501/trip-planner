import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { Inject } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/config.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  REMINDER_QUEUE_NAME,
  type EmailJobDetail,
  type ReminderJobData,
} from './reminder.constants.js';

/**
 * BullMQ worker for trip-reminders. Mirrors processReminderJob in the legacy
 * `queue/reminderQueue.ts`: load todo, send Brevo email, update isNotified,
 * write email_job_logs row.
 */
@Processor(REMINDER_QUEUE_NAME)
export class ReminderProcessor extends WorkerHost {
  private readonly logger = new Logger('ReminderProcessor');

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async process(job: Job<ReminderJobData>): Promise<EmailJobDetail> {
    const triggeredAt = new Date();

    const todoRow = await this.prisma.todo.findUnique({
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
      await this.writeJobLog(triggeredAt, 0, 0, [detail]);
      return detail;
    }

    if (todoRow.isNotified) {
      return {
        todo_id: todoRow.id,
        task_name: todoRow.taskName,
        trip_title: todoRow.trip?.title ?? '',
        status: 'sent',
        retry_count: todoRow.retryCount,
        error: 'already notified — no-op',
      };
    }

    const fallback = this.config.REMINDER_FALLBACK_EMAIL ?? '';
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
      await this.writeJobLog(triggeredAt, 1, 0, [detail]);
      throw new Error(detail.error);
    }

    const tripTitle = todoRow.trip?.title ?? '未命名行程';
    const subject = `【提醒】${tripTitle} 的待辦：${todoRow.taskName}`;
    const htmlContent = `<strong>時間到囉！</strong><br>您在行程「<strong>${escapeHtml(tripTitle)}</strong>」中設定的待辦事項「<strong>${escapeHtml(todoRow.taskName)}</strong>」已經到期了，請趕快去處理吧！`;

    try {
      await this.sendBrevoEmail({ to: recipient, subject, htmlContent });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const newCount = todoRow.retryCount + 1;
      await this.prisma.todo.update({
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
      await this.writeJobLog(triggeredAt, 1, 0, [detail]);
      throw err;
    }

    await this.prisma.todo.update({
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
    await this.writeJobLog(triggeredAt, 1, 1, [detail]);
    return detail;
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<ReminderJobData> | undefined, err: Error): void {
    this.logger.error(`job ${job?.id} failed`, err.stack ?? err.message);
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<ReminderJobData>): void {
    this.logger.log(`job ${job.id} completed`);
  }

  private async sendBrevoEmail(payload: {
    to: string;
    subject: string;
    htmlContent: string;
  }): Promise<void> {
    const apiKey = this.config.BREVO_API_KEY;
    const senderEmail = this.config.BREVO_SENDER_EMAIL;
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

  private async writeJobLog(
    triggeredAt: Date,
    totalFound: number,
    sentCount: number,
    details: EmailJobDetail[],
  ): Promise<void> {
    try {
      await this.prisma.emailJobLog.create({
        data: {
          triggeredAt,
          totalFound,
          sentCount,
          details: details as object,
          source: 'bullmq',
        },
      });
    } catch (err) {
      this.logger.error('failed to write email_job_logs', err as Error);
    }
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
